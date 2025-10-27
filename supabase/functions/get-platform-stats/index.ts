import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.87.6';
import { getAccount, getAssociatedTokenAddress } from 'npm:@solana/spl-token@0.3.9';
import { VAULT_WALLET, AURACLE_MINT } from "@shared/constants.ts";

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const AURACLE_DECIMALS = 6;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Get number of stakers from database
    const { data: stakers, error: stakersError } = await supabaseClient
      .from('stakers')
      .select('wallet_address');

    if (stakersError) throw stakersError;

    const numberOfStakers = stakers?.length || 0;

    const connection = new Connection(MAINNET_RPC, 'confirmed');
    const vaultPublicKey = new PublicKey(VAULT_WALLET);
    const mintPublicKey = new PublicKey(AURACLE_MINT);

    // Fetch real vault SOL balance from Solana blockchain
    let vaultSolBalance = 0;
    try {
      const balance = await connection.getBalance(vaultPublicKey);
      vaultSolBalance = balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error fetching vault SOL balance:', error);
    }

    // Fetch real AURACLE token balance from vault wallet
    let totalStaked = 0;
    try {
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        vaultPublicKey
      );
      const accountInfo = await getAccount(connection, vaultTokenAccount);
      totalStaked = Number(accountInfo.amount) / Math.pow(10, AURACLE_DECIMALS);
    } catch (error) {
      console.error('Error fetching vault AURACLE balance:', error);
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