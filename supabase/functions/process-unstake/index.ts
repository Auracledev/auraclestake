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
    
    // Read the raw body first for debugging
    const bodyText = await req.text();
    console.log('Raw request body:', bodyText);
    
    // Parse the JSON
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return new Response(
        JSON.stringify({ error: `Failed to parse JSON: ${parseError.message}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { walletAddress, amount, serializedTransaction } = body;
    
    console.log('Parsed request:', { walletAddress, amount, txLength: serializedTransaction?.length });

    if (!walletAddress || !amount || !serializedTransaction) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert amount from string to number
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user has enough staked
    const { data: stakeData, error: stakeError } = await supabase
      .from('stakes')
      .select('amount')
      .eq('wallet_address', walletAddress)
      .single();

    if (stakeError || !stakeData) {
      return new Response(
        JSON.stringify({ error: 'No stake found for this wallet' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (stakeData.amount < amountNum) {
      return new Response(
        JSON.stringify({ error: 'Insufficient staked amount' }),
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
    const newAmount = stakeData.amount - amountNum;
    if (newAmount === 0) {
      await supabase
        .from('stakes')
        .delete()
        .eq('wallet_address', walletAddress);
    } else {
      await supabase
        .from('stakes')
        .update({ amount: newAmount, updated_at: new Date().toISOString() })
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