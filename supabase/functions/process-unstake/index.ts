import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Connection, Transaction, Keypair, PublicKey, sendAndConfirmTransaction } from 'https://esm.sh/@solana/web3.js@1.87.6';
import { getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from 'https://esm.sh/@solana/spl-token@0.3.9';
import { corsHeaders } from '@shared/cors.ts';
import { MAX_UNSTAKE_AMOUNT, SIGNATURE_EXPIRY_MS } from '@shared/constants.ts';
import nacl from 'https://esm.sh/tweetnacl@1.0.3';
import bs58 from 'https://esm.sh/bs58@5.0.0';

const SOLANA_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=e9ab9721-93fa-4533-b148-7e240bd38192';
const AURACLE_MINT = '5EoNPSEMcFMuzz3Fr7ho3TiweifUumLaBXMQpVZRpump';
const AURACLE_DECIMALS = 6;
const UNSTAKE_LOCK_DURATION = 30; // seconds

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  try {
    const { walletAddress, amount, message, signature, timestamp } = await req.json();
    
    console.log('Unstake request:', { walletAddress, amount, hasMessage: !!message, hasSignature: !!signature, timestamp });

    if (!walletAddress || !amount || amount <= 0 || !message || !signature) {
      console.error('Missing parameters:', { walletAddress: !!walletAddress, amount, message: !!message, signature: !!signature });
      return new Response(
        JSON.stringify({ error: 'Invalid request parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate timestamp (5-minute expiry)
    if (timestamp) {
      const requestTime = new Date(timestamp).getTime();
      const now = Date.now();
      if (now - requestTime > SIGNATURE_EXPIRY_MS) {
        console.error('Signature expired:', { timestamp, now, diff: now - requestTime });
        return new Response(
          JSON.stringify({ error: 'Signature expired. Please try again.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Validate amount limits
    if (amount > MAX_UNSTAKE_AMOUNT) {
      console.error('Amount exceeds maximum:', amount);
      return new Response(
        JSON.stringify({ error: `Maximum unstake amount is ${MAX_UNSTAKE_AMOUNT} AURACLE` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify message signature
    try {
      console.log('Verifying signature...');
      const publicKey = new PublicKey(walletAddress);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
      
      console.log('Message:', message);
      console.log('Signature length:', signatureBytes.length);
      
      const verified = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes()
      );

      if (!verified) {
        console.error('Signature verification failed - signature does not match');
        throw new Error('Invalid signature');
      }

      console.log('Signature verified successfully');
    } catch (verifyError) {
      console.error('Signature verification failed:', verifyError);
      console.error('Error details:', verifyError.message, verifyError.stack);
      return new Response(
        JSON.stringify({ error: `Invalid wallet signature: ${verifyError.message}` }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase config');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for existing unstake lock
    const { data: existingLock } = await supabase
      .from('stakers')
      .select('unstake_locked_until')
      .eq('wallet_address', walletAddress)
      .single();

    if (existingLock?.unstake_locked_until) {
      const lockExpiry = new Date(existingLock.unstake_locked_until);
      if (lockExpiry > new Date()) {
        console.log('Unstake already in progress for wallet:', walletAddress);
        return new Response(
          JSON.stringify({ error: 'Unstake already in progress. Please wait a moment and try again.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Set unstake lock
    const lockUntil = new Date(Date.now() + UNSTAKE_LOCK_DURATION * 1000).toISOString();
    const { error: lockError } = await supabase
      .from('stakers')
      .update({ unstake_locked_until: lockUntil })
      .eq('wallet_address', walletAddress);

    if (lockError) {
      console.error('Failed to set unstake lock:', lockError);
      return new Response(
        JSON.stringify({ error: 'Failed to process unstake request' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Unstake lock set until:', lockUntil);

    try {
      // Verify user has enough staked (with version for optimistic locking)
      const { data: stakerData, error: stakerError } = await supabase
        .from('stakers')
        .select('staked_amount, version')
        .eq('wallet_address', walletAddress)
        .single();

      if (stakerError || !stakerData) {
        console.error('Staker lookup error:', stakerError);
        throw new Error('No stake found for this wallet');
      }

      if (stakerData.staked_amount < amount) {
        throw new Error(`Insufficient staked balance. You have ${stakerData.staked_amount} AURACLE staked.`);
      }

      // Get vault private key
      const vaultPrivateKeyStr = Deno.env.get('VAULT_PRIVATE_KEY');
      if (!vaultPrivateKeyStr) {
        console.error('Missing VAULT_PRIVATE_KEY');
        throw new Error('Vault key not configured');
      }

      console.log('Creating Solana transaction...');
      
      // Parse vault keypair
      let vaultSecretKey;
      try {
        const parsed = JSON.parse(vaultPrivateKeyStr);
        if (Array.isArray(parsed)) {
          vaultSecretKey = Uint8Array.from(parsed);
        } else {
          throw new Error('VAULT_PRIVATE_KEY must be a JSON array of numbers');
        }
      } catch (parseError) {
        console.error('Failed to parse VAULT_PRIVATE_KEY:', parseError.message);
        throw new Error('Invalid vault key format');
      }

      const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
      const vaultKeypair = Keypair.fromSecretKey(vaultSecretKey);
      const userPublicKey = new PublicKey(walletAddress);
      const mintPublicKey = new PublicKey(AURACLE_MINT);

      console.log('Vault address:', vaultKeypair.publicKey.toString());

      // Get token accounts
      const fromTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        vaultKeypair.publicKey
      );
      
      const toTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        userPublicKey
      );

      console.log('From token account:', fromTokenAccount.toString());
      console.log('To token account:', toTokenAccount.toString());

      // Check if user's token account exists
      const toAccountInfo = await connection.getAccountInfo(toTokenAccount);
      
      // Build transaction
      const transaction = new Transaction();
      
      // Create associated token account if it doesn't exist
      if (!toAccountInfo) {
        console.log('Creating associated token account for user...');
        const createAccountIx = createAssociatedTokenAccountInstruction(
          vaultKeypair.publicKey, // payer
          toTokenAccount,
          userPublicKey,
          mintPublicKey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        transaction.add(createAccountIx);
      }

      // Create transfer instruction
      const amountInLamports = BigInt(Math.floor(amount * Math.pow(10, AURACLE_DECIMALS)));
      console.log('Transfer amount (lamports):', amountInLamports.toString());

      const transferInstruction = createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        vaultKeypair.publicKey,
        amountInLamports,
        [],
        TOKEN_PROGRAM_ID
      );
      
      transaction.add(transferInstruction);

      // Set transaction properties
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = vaultKeypair.publicKey;

      console.log('Signing and sending transaction...');
      
      // Sign the transaction
      transaction.sign(vaultKeypair);
      
      // Send transaction without WebSocket confirmation
      const txSignature = await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        }
      );

      console.log('Transaction sent:', txSignature);

      // Wait for confirmation using polling
      console.log('Waiting for transaction confirmation...');
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      
      await connection.confirmTransaction({
        signature: txSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, 'confirmed');

      console.log('Transaction confirmed on-chain');

      // Update database with version check (optimistic locking)
      console.log('Updating staker balance from', stakerData.staked_amount, 'to', stakerData.staked_amount - amount);
      const newAmount = stakerData.staked_amount - amount;
      
      console.log('Updating staker balance to:', newAmount);
      const { data: updateData, error: updateError } = await supabase
        .from('stakers')
        .update({ 
          staked_amount: newAmount, 
          last_updated: new Date().toISOString(),
          version: stakerData.version + 1,
          unstake_locked_until: null // Release lock
        })
        .eq('wallet_address', walletAddress)
        .eq('version', stakerData.version) // Optimistic locking - only update if version matches
        .select();
      
      if (updateError) {
        console.error('Error updating staker:', updateError);
        console.error('Update error details:', JSON.stringify(updateError));
        throw new Error(`Failed to update staker: ${updateError.message}`);
      }

      if (!updateData || updateData.length === 0) {
        console.error('Version mismatch - concurrent unstake detected');
        throw new Error('Concurrent unstake detected. Please try again.');
      }

      console.log('Staker updated successfully:', updateData);

      // Record transaction
      console.log('Recording transaction...');
      const { data: txData, error: txError } = await supabase.from('transactions').insert({
        wallet_address: walletAddress,
        type: 'unstake',
        amount,
        token: 'AURACLE',
        tx_signature: txSignature,
        status: 'completed'
      }).select();
      
      if (txError) {
        console.error('Error recording transaction:', txError);
        console.error('Transaction error details:', JSON.stringify(txError));
        throw new Error(`Failed to record transaction: ${txError.message}`);
      }

      console.log('Transaction recorded successfully:', txData);
      console.log('Database updated successfully');

      return new Response(
        JSON.stringify({ success: true, signature: txSignature }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (innerError) {
      // Release lock on error
      await supabase
        .from('stakers')
        .update({ unstake_locked_until: null })
        .eq('wallet_address', walletAddress);
      
      throw innerError;
    }

  } catch (error) {
    console.error('Unstake error:', error);
    console.error('Error stack:', error.stack);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});