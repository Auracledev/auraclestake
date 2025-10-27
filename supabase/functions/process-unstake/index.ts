import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Connection, Transaction, Keypair, PublicKey } from 'https://esm.sh/@solana/web3.js@1.87.6';
import { getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from 'https://esm.sh/@solana/spl-token@0.3.9';
import { corsHeaders } from '@shared/cors.ts';
import { MAX_UNSTAKE_AMOUNT, SIGNATURE_EXPIRY_MS } from '@shared/constants.ts';
import { checkTransactionDuplicate } from '@shared/transaction-dedup.ts';
import nacl from 'https://esm.sh/tweetnacl@1.0.3';
import bs58 from 'https://esm.sh/bs58@5.0.0';

const SOLANA_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=e9ab9721-93fa-4533-b148-7e240bd38192';
const AURACLE_MINT = '5EoNPSEMcFMuzz3Fr7ho3TiweifUumLaBXMQpVZRpump';
const AURACLE_DECIMALS = 6;
const UNSTAKE_LOCK_DURATION = 120; // Increased to 120 seconds

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  try {
    const { walletAddress, amount, message, signature, timestamp, txSignature } = await req.json();
    
    console.log('Unstake request:', { walletAddress, amount, hasMessage: !!message, hasSignature: !!signature, timestamp, txSignature });

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase config');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ATOMIC LOCK CHECK AND SET - prevents race condition
    const lockUntil = new Date(Date.now() + UNSTAKE_LOCK_DURATION * 1000).toISOString();
    
    // Use database transaction to atomically check and set lock
    const { data: lockResult, error: lockError } = await supabase.rpc('set_unstake_lock', {
      p_wallet_address: walletAddress,
      p_lock_until: lockUntil
    });

    if (lockError || !lockResult) {
      console.log('Failed to acquire unstake lock:', lockError?.message || 'Lock already exists');
      return new Response(
        JSON.stringify({ error: 'Unstake already in progress. Please wait and try again.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Unstake lock acquired until:', lockUntil);

    let transactionSucceeded = false;
    let solanaSignature = '';

    try {
      // VERIFY BALANCE AFTER LOCK IS SET
      const { data: stakerData, error: stakerError } = await supabase
        .from('stakers')
        .select('staked_amount')
        .eq('wallet_address', walletAddress)
        .single();

      if (stakerError || !stakerData) {
        console.error('Staker lookup error:', stakerError);
        throw new Error('No stake found for this wallet');
      }

      if (stakerData.staked_amount < amount) {
        throw new Error(`Insufficient staked balance. You have ${stakerData.staked_amount} AURACLE staked.`);
      }

      // Check for duplicate transaction signature (if provided)
      if (txSignature) {
        const dedupResult = await checkTransactionDuplicate(supabase, txSignature);
        if (dedupResult.isDuplicate) {
          console.log('Duplicate transaction detected:', txSignature);
          throw new Error('Transaction already processed');
        }
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
          vaultKeypair.publicKey,
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
      
      // Send transaction
      solanaSignature = await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        }
      );

      console.log('Transaction sent:', solanaSignature);

      // Poll for confirmation
      console.log('Polling for transaction confirmation...');
      let confirmed = false;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (!confirmed && attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          const status = await connection.getSignatureStatus(solanaSignature);
          if (status?.value?.confirmationStatus === 'confirmed' || 
              status?.value?.confirmationStatus === 'finalized') {
            confirmed = true;
            console.log('Transaction confirmed on-chain');
          }
        } catch (pollError) {
          console.log('Poll attempt', attempts, 'failed:', pollError.message);
        }
      }
      
      if (!confirmed) {
        throw new Error('Transaction confirmation timeout');
      }

      transactionSucceeded = true;

      // Update database
      console.log('Updating staker balance from', stakerData.staked_amount, 'to', stakerData.staked_amount - amount);
      const newAmount = stakerData.staked_amount - amount;
      
      // ANY unstake resets first_staked_at
      const { error: updateError } = await supabase
        .from('stakers')
        .update({ 
          staked_amount: newAmount, 
          first_staked_at: null,  // Reset loyalty timer on ANY unstake
          last_updated: new Date().toISOString(),
          unstake_locked_until: null
        })
        .eq('wallet_address', walletAddress);
      
      if (updateError) {
        console.error('Error updating staker:', updateError);
        throw new Error(`Failed to update staker: ${updateError.message}`);
      }

      console.log('Staker updated successfully');

      // Record transaction
      const { error: txError } = await supabase.from('transactions').insert({
        wallet_address: walletAddress,
        type: 'unstake',
        amount,
        token: 'AURACLE',
        tx_signature: solanaSignature,
        status: 'completed'
      });
      
      if (txError) {
        console.error('Error recording transaction:', txError);
      }

      console.log('Database updated successfully');

      return new Response(
        JSON.stringify({ success: true, signature: solanaSignature }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (innerError) {
      // ONLY release lock if transaction did NOT succeed on-chain
      if (!transactionSucceeded) {
        console.log('Releasing lock due to error before transaction success');
        await supabase
          .from('stakers')
          .update({ unstake_locked_until: null })
          .eq('wallet_address', walletAddress);
      } else {
        console.log('Transaction succeeded on-chain but DB update failed - keeping lock to prevent double-spend');
      }
      
      throw innerError;
    }

  } catch (error) {
    console.error('Unstake error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});