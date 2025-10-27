import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { ADMIN_WALLET, VAULT_WALLET } from "@shared/constants.ts";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.87.6';

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const WEEKLY_REWARD_RATE = 0.005; // 0.5% weekly = 26% APY

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { adminWallet, autoRun } = await req.json();

    if (!autoRun && adminWallet !== ADMIN_WALLET) {
      throw new Error('Unauthorized: Admin access required');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_KEY') ?? ''
    );

    // Get vault SOL balance from blockchain
    const connection = new Connection(MAINNET_RPC, 'confirmed');
    const vaultPublicKey = new PublicKey(VAULT_WALLET);
    const vaultBalance = await connection.getBalance(vaultPublicKey);
    const vaultSOL = vaultBalance / LAMPORTS_PER_SOL;

    const { data: stakers } = await supabaseClient
      .from('stakers')
      .select('*')
      .gt('staked_amount', 0);

    if (!stakers || stakers.length === 0) {
      throw new Error('No active stakers found');
    }

    const totalStaked = stakers.reduce((sum, s) => sum + parseFloat(s.staked_amount), 0);

    if (totalStaked === 0) {
      throw new Error('No tokens staked');
    }

    const rewards = [];
    let totalRewardsDistributed = 0;

    for (const staker of stakers) {
      const stakedAmount = parseFloat(staker.staked_amount);
      const stakerShare = stakedAmount / totalStaked;
      
      // Calculate reward: 0.5% of staked amount, distributed proportionally from vault
      const baseReward = stakedAmount * WEEKLY_REWARD_RATE;
      const rewardInSOL = (baseReward / totalStaked) * vaultSOL * 0.1; // Use 10% of vault for weekly rewards
      
      const newPendingRewards = parseFloat(staker.pending_rewards || 0) + rewardInSOL;
      
      await supabaseClient
        .from('stakers')
        .update({ 
          pending_rewards: newPendingRewards,
          last_updated: new Date().toISOString()
        })
        .eq('wallet_address', staker.wallet_address);

      rewards.push({
        wallet_address: staker.wallet_address,
        staked: stakedAmount,
        reward: rewardInSOL,
        newBalance: newPendingRewards
      });

      totalRewardsDistributed += rewardInSOL;
    }

    // Update platform stats
    await supabaseClient
      .from('platform_stats')
      .update({ 
        vault_sol_balance: vaultSOL,
        weekly_reward_pool: totalRewardsDistributed,
        last_updated: new Date().toISOString()
      });

    await supabaseClient
      .from('admin_actions')
      .insert({
        admin_wallet: adminWallet || 'auto_cron',
        action_type: 'calculate_rewards',
        details: { 
          totalStakers: stakers.length,
          totalRewards: totalRewardsDistributed,
          vaultBalance: vaultSOL,
          rewardRate: `${WEEKLY_REWARD_RATE * 100}%`,
          timestamp: new Date().toISOString()
        }
      });

    return new Response(
      JSON.stringify({ 
        success: true, 
        rewards,
        summary: {
          totalStakers: stakers.length,
          totalRewards: totalRewardsDistributed,
          averageReward: totalRewardsDistributed / stakers.length,
          vaultBalance: vaultSOL,
          rewardRate: `${WEEKLY_REWARD_RATE * 100}% weekly`
        }
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