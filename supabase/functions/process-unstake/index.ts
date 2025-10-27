import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Connection, Transaction, Keypair, PublicKey } from 'https://esm.sh/@solana/web3.js@1.87.6';
import { corsHeaders } from '@shared/cors.ts';

const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Process unstake request received');
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    
    // Read the raw body first for debugging
    const bodyText = await req.text();
    console.log('Raw request body:', bodyText);
    console.log('Body length:', bodyText.length);
    
    // Parse the JSON
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Failed to parse body:', bodyText);
      return new Response(
        JSON.stringify({ 
          error: `Failed to parse JSON: ${parseError.message}`,
          receivedBody: bodyText.substring(0, 100)
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { walletAddress, amount, serializedTransaction, signature, message } = body;
    
    console.log('Parsed request:', { walletAddress, amount, hasSignature: !!signature, hasMessage: !!message });

    // Verify wallet signature
    if (!signature || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing signature or message for verification' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isValidSignature = await verifyWalletSignature(walletAddress, signature, message);
    if (!isValidSignature) {
      console.error('Invalid wallet signature');
      return new Response(
        JSON.stringify({ error: 'Invalid wallet signature' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Wallet signature verified successfully');

    // Convert amount from string to number
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client - check env vars first
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY');
    
    console.log('Env check:', { 
      hasUrl: !!supabaseUrl, 
      hasKey: !!supabaseKey,
      urlValue: supabaseUrl 
    });
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user has enough staked
    console.log('Querying stakers for wallet:', walletAddress);
    
    const { data: stakerData, error: stakerError } = await supabase
      .from('stakers')
      .select('staked_amount')
      .eq('wallet_address', walletAddress)
      .single();

    console.log('Staker query result:', { stakerData, stakerError });

    if (stakerError || !stakerData) {
      // Try to get all stakers to debug
      const { data: allStakers } = await supabase
        .from('stakers')
        .select('wallet_address, staked_amount')
        .limit(5);
      
      console.log('Sample stakers in DB:', allStakers);
      
      return new Response(
        JSON.stringify({ error: 'No stake found for this wallet' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (stakerData.staked_amount < amountNum) {
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

    // Deserialize and sign transaction
    const connection = new Connection(SOLANA_RPC_URL);
    const txBuffer = Uint8Array.from(atob(serializedTransaction), c => c.charCodeAt(0));
    const transaction = Transaction.from(txBuffer);

    // Sign with vault key
    const vaultKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(vaultPrivateKeyStr))
    );
    transaction.sign(vaultKeypair);

    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature);

    // Update database
    const newAmount = stakerData.staked_amount - amountNum;
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
      amount: amountNum,
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