import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.87.6';
import { VAULT_WALLET } from "@shared/constants.ts";

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Calculate stats from stakers table
    const { data: stakers, error: stakersError } = await supabaseClient
      .from('stakers')
      .select('staked_amount');

    if (stakersError) throw stakersError;

    const totalStaked = stakers?.reduce((sum, s) => sum + s.staked_amount, 0) || 0;
    const numberOfStakers = stakers?.length || 0;

    // Fetch real vault SOL balance from Solana blockchain
    let vaultSolBalance = 0;
    try {
      const connection = new Connection(MAINNET_RPC, 'confirmed');
      const vaultPublicKey = new PublicKey(VAULT_WALLET);
      const balance = await connection.getBalance(vaultPublicKey);
      vaultSolBalance = balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error fetching vault balance:', error);
    }

    // Calculate weekly reward pool (50% of vault balance)
    const weeklyRewardPool = vaultSolBalance * 0.5;

    const stats = {
      total_staked: totalStaked,
      number_of_stakers: numberOfStakers,
      vault_sol_balance: vaultSolBalance,
      weekly_reward_pool: weeklyRewardPool
    };

    return new Response(
      JSON.stringify({ stats }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});