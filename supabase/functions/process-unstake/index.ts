import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Connection, Keypair, PublicKey, Transaction } from 'https://esm.sh/@solana/web3.js@1.87.6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.json();
    const { walletAddress, amount, serializedTransaction } = body;

    console.log('Unstake request:', { walletAddress, amount, hasTransaction: !!serializedTransaction });

    if (!walletAddress || !amount || !serializedTransaction) {
      console.error('Missing fields:', { walletAddress: !!walletAddress, amount: !!amount, serializedTransaction: !!serializedTransaction });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: walletAddress, amount, or serializedTransaction' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY')) ?? ''
    );

    const maxRetries = 3;
    let retryCount = 0;
    let success = false;
    let newStakedAmount = 0;
    let signature = '';

    while (retryCount < maxRetries && !success) {
      const { data: staker, error: stakerError } = await supabaseClient
        .from('stakers')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (stakerError || !staker) {
        throw new Error('Staker not found');
      }

      const requestedAmount = parseFloat(amount);
      if (requestedAmount > staker.staked_amount) {
        throw new Error(`Insufficient staked balance. You have ${staker.staked_amount} AURACLE staked.`);
      }

      const currentVersion = staker.version || 1;

      const vaultPrivateKey = Deno.env.get('VAULT_PRIVATE_KEY');
      if (!vaultPrivateKey) {
        throw new Error('Vault private key not configured');
      }

      const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
      const vaultKeypair = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(vaultPrivateKey))
      );

      // Deserialize the UNSIGNED transaction
      const transaction = Transaction.from(
        Buffer.from(serializedTransaction, 'base64')
      );

      // Sign with vault key (vault is the authority for the transfer)
      transaction.sign(vaultKeypair);

      // Send the signed transaction
      signature = await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        }
      );
      
      await connection.confirmTransaction(signature, 'confirmed');

      // Check for duplicate
      const { data: existingTx } = await supabaseClient
        .from('transactions')
        .select('*')
        .eq('tx_signature', signature)
        .single();

      if (existingTx) {
        console.log('Transaction already recorded:', signature);
        return new Response(
          JSON.stringify({ 
            success: true,
            signature,
            message: 'Transaction already processed',
            existingTransaction: existingTx
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      newStakedAmount = staker.staked_amount - requestedAmount;

      const { data: updateData, error: updateError } = await supabaseClient
        .from('stakers')
        .update({ 
          staked_amount: newStakedAmount,
          last_updated: new Date().toISOString(),
          version: currentVersion + 1
        })
        .eq('wallet_address', walletAddress)
        .eq('version', currentVersion)
        .select();

      if (updateError) {
        console.error('Error updating staker:', updateError);
        throw new Error(`Failed to update staker: ${updateError.message}`);
      }

      if (!updateData || updateData.length === 0) {
        retryCount++;
        console.log(`Version conflict detected, retry ${retryCount}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
        continue;
      }

      success = true;
    }

    if (!success) {
      throw new Error('Failed to update staker after multiple retries. Transaction may have succeeded but database update failed. Signature: ' + signature);
    }

    await supabaseClient
      .from('transactions')
      .insert({
        wallet_address: walletAddress,
        type: 'unstake',
        amount: parseFloat(amount),
        token: 'AURACLE',
        tx_signature: signature,
        status: 'completed'
      });

    const { data: allStakers } = await supabaseClient
      .from('stakers')
      .select('staked_amount');

    const totalStaked = allStakers?.reduce((sum, s) => sum + parseFloat(s.staked_amount), 0) || 0;
    const numberOfStakers = allStakers?.filter(s => parseFloat(s.staked_amount) > 0).length || 0;

    await supabaseClient
      .from('platform_stats')
      .update({ 
        total_staked: totalStaked,
        number_of_stakers: numberOfStakers,
        last_updated: new Date().toISOString()
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        signature,
        newStakedAmount 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unstake error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});