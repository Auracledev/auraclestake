import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { Connection, PublicKey, Transaction, Keypair } from 'npm:@solana/web3.js@1.87.6';
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  TOKEN_PROGRAM_ID 
} from 'npm:@solana/spl-token@0.3.9';
import { VAULT_WALLET, AURACLE_MINT } from "@shared/constants.ts";

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { walletAddress, amount, serializedTransaction } = await req.json();

    if (!walletAddress || !amount || !serializedTransaction) {
      throw new Error('Missing required fields');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_KEY') ?? ''
    );

    // Verify user has enough staked
    const { data: staker, error: stakerError } = await supabaseClient
      .from('stakers')
      .select('staked_amount')
      .eq('wallet_address', walletAddress)
      .single();

    if (stakerError || !staker) {
      throw new Error('Staker not found');
    }

    const requestedAmount = parseFloat(amount);
    if (requestedAmount > staker.staked_amount) {
      throw new Error(`Insufficient staked balance. You have ${staker.staked_amount} AURACLE staked.`);
    }

    // Get vault keypair from environment
    const vaultPrivateKey = Deno.env.get('VAULT_PRIVATE_KEY');
    if (!vaultPrivateKey) {
      throw new Error('Vault private key not configured');
    }

    const connection = new Connection(MAINNET_RPC, 'confirmed');
    const vaultKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(vaultPrivateKey))
    );

    // Deserialize and sign the transaction
    const transaction = Transaction.from(
      Buffer.from(serializedTransaction, 'base64')
    );

    // Sign with vault keypair
    transaction.partialSign(vaultKeypair);

    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    // Update database
    const newStakedAmount = staker.staked_amount - requestedAmount;

    await supabaseClient
      .from('stakers')
      .update({ 
        staked_amount: newStakedAmount,
        last_updated: new Date().toISOString()
      })
      .eq('wallet_address', walletAddress);

    await supabaseClient
      .from('transactions')
      .insert({
        wallet_address: walletAddress,
        type: 'unstake',
        amount: requestedAmount,
        token: 'AURACLE',
        tx_signature: signature,
        status: 'completed'
      });

    // Update platform stats
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
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
