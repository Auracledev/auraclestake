import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Connection, Transaction, Keypair, PublicKey, sendAndConfirmTransaction } from 'https://esm.sh/@solana/web3.js@1.87.6';
import { getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from 'https://esm.sh/@solana/spl-token@0.3.9';
import { corsHeaders } from '@shared/cors.ts';
import nacl from 'https://esm.sh/tweetnacl@1.0.3';
import bs58 from 'https://esm.sh/bs58@5.0.0';

const SOLANA_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=e9ab9721-93fa-4533-b148-7e240bd38192';
const AURACLE_MINT = '5EoNPSEMcFMuzz3Fr7ho3TiweifUumLaBXMQpVZRpump';
const AURACLE_DECIMALS = 6;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  try {
    const { walletAddress, amount, message, signature } = await req.json();
    
    console.log('Unstake request:', { walletAddress, amount });

    if (!walletAddress || !amount || amount <= 0 || !message || !signature) {
      return new Response(
        JSON.stringify({ error: 'Invalid request parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify message signature
    try {
      const publicKey = new PublicKey(walletAddress);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
      
      const verified = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes()
      );

      if (!verified) {
        throw new Error('Invalid signature');
      }

      console.log('Signature verified successfully');
    } catch (verifyError) {
      console.error('Signature verification failed:', verifyError);
      return new Response(
        JSON.stringify({ error: 'Invalid wallet signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase config');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user has enough staked
    const { data: stakerData, error: stakerError } = await supabase
      .from('stakers')
      .select('staked_amount')
      .eq('wallet_address', walletAddress)
      .single();

    if (stakerError || !stakerData) {
      console.error('Staker lookup error:', stakerError);
      return new Response(
        JSON.stringify({ error: 'No stake found for this wallet' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (stakerData.staked_amount < amount) {
      return new Response(
        JSON.stringify({ error: `Insufficient staked balance. You have ${stakerData.staked_amount} AURACLE staked.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get vault private key
    const vaultPrivateKeyStr = Deno.env.get('VAULT_PRIVATE_KEY');
    if (!vaultPrivateKeyStr) {
      console.error('Missing VAULT_PRIVATE_KEY');
      return new Response(
        JSON.stringify({ error: 'Vault key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'Invalid vault key format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
    const txSignature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [vaultKeypair],
      { commitment: 'confirmed' }
    );

    console.log('Transaction confirmed:', txSignature);

    // Update database
    const newAmount = stakerData.staked_amount - amount;
    if (newAmount === 0) {
      await supabase
        .from('stakers')
        .delete()
        .eq('wallet_address', walletAddress);
    } else {
      await supabase
        .from('stakers')
        .update({ staked_amount: newAmount, updated_at: new Date().toISOString() })
        .eq('wallet_address', walletAddress);
    }

    // Record transaction
    await supabase.from('transactions').insert({
      wallet_address: walletAddress,
      type: 'unstake',
      amount,
      signature: txSignature,
      status: 'completed'
    });

    console.log('Database updated successfully');

    return new Response(
      JSON.stringify({ success: true, signature: txSignature }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unstake error:', error);
    console.error('Error stack:', error.stack);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});