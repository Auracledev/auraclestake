import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Connection, Transaction, Keypair, PublicKey } from 'https://esm.sh/@solana/web3.js@1.87.6';
import { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } from 'https://esm.sh/@solana/spl-token@0.3.9';
import { corsHeaders } from '@shared/cors.ts';

const SOLANA_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=e9ab9721-93fa-4533-b148-7e240bd38192';
const AURACLE_MINT = 'AURcLxmEcpBEo1Ey5WXPZvPvYvvJqMGYvz8YT9ksZpUm';
const AURACLE_DECIMALS = 6;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  try {
    const { walletAddress, amount } = await req.json();
    
    console.log('Unstake request:', { walletAddress, amount });

    if (!walletAddress || !amount || amount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
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
      return new Response(
        JSON.stringify({ error: 'Vault key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create and send transaction
    const connection = new Connection(SOLANA_RPC_URL);
    const vaultKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(vaultPrivateKeyStr))
    );
    const userPublicKey = new PublicKey(walletAddress);
    const mintPublicKey = new PublicKey(AURACLE_MINT);

    // Get token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      vaultKeypair.publicKey
    );
    
    const toTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      userPublicKey
    );

    // Create transfer instruction
    const transferInstruction = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      vaultKeypair.publicKey,
      BigInt(Math.floor(amount * Math.pow(10, AURACLE_DECIMALS))),
      [],
      TOKEN_PROGRAM_ID
    );

    // Build and send transaction
    const transaction = new Transaction().add(transferInstruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = vaultKeypair.publicKey;
    transaction.sign(vaultKeypair);

    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature);

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
      signature,
      status: 'completed'
    });

    return new Response(
      JSON.stringify({ success: true, signature }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unstake error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});