import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { ADMIN_WALLET, VAULT_WALLET } from "@shared/constants.ts";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.87.6';

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

// Loyalty boost tiers based on continuous staking days
function getLoyaltyBoost(stakingDays: number): number {
  if (stakingDays >= 90) return 1.5;  // 50% boost
  if (stakingDays >= 60) return 1.4;  // 40% boost
  if (stakingDays >= 30) return 1.3;  // 30% boost
  if (stakingDays >= 7) return 1.1;   // 10% boost
  return 1.0;                          // No boost
}

function calculateStakingDays(firstStakedAt: string): number {
  const firstStaked = new Date(firstStakedAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - firstStaked.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

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

    // Calculate weighted shares with loyalty boost
    let totalWeightedShares = 0;
    const stakerData = [];

    for (const staker of stakers) {
      const stakedAmount = parseFloat(staker.staked_amount);
      const stakingDays = calculateStakingDays(staker.first_staked_at);
      const loyaltyBoost = getLoyaltyBoost(stakingDays);
      const weightedShares = stakedAmount * loyaltyBoost;

      stakerData.push({
        ...staker,
        stakedAmount,
        stakingDays,
        loyaltyBoost,
        weightedShares
      });

      totalWeightedShares += weightedShares;
    }

    if (totalWeightedShares === 0) {
      throw new Error('No weighted shares calculated');
    }

    // Weekly reward pool = 50% of vault SOL
    const weeklyRewardPool = vaultSOL * 0.5;

    const rewards = [];
    let totalRewardsDistributed = 0;

    for (const staker of stakerData) {
      // User's share based on weighted shares (includes loyalty boost)
      const userShare = staker.weightedShares / totalWeightedShares;
      const weeklyReward = weeklyRewardPool * userShare;
      
      const newPendingRewards = parseFloat(staker.pending_rewards || 0) + weeklyReward;
      
      await supabaseClient
        .from('stakers')
        .update({ 
          pending_rewards: newPendingRewards,
          last_updated: new Date().toISOString()
        })
        .eq('wallet_address', staker.wallet_address);

      rewards.push({
        wallet_address: staker.wallet_address,
        staked: staker.stakedAmount,
        stakingDays: staker.stakingDays,
        loyaltyBoost: staker.loyaltyBoost,
        weightedShares: staker.weightedShares,
        sharePercentage: (userShare * 100).toFixed(2) + '%',
        reward: weeklyReward,
        newBalance: newPendingRewards
      });

      totalRewardsDistributed += weeklyReward;
    }

    // Update platform stats
    await supabaseClient
      .from('platform_stats')
      .update({ 
        vault_sol_balance: vaultSOL,
        weekly_reward_pool: weeklyRewardPool,
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
          totalWeightedShares,
          vaultBalance: vaultSOL,
          weeklyRewardPool: weeklyRewardPool,
          vaultPercentage: '50%',
          loyaltyBoostEnabled: true,
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
          totalWeightedShares,
          averageReward: totalRewardsDistributed / stakers.length,
          vaultBalance: vaultSOL,
          weeklyRewardPool: weeklyRewardPool,
          vaultPercentage: '50%',
          loyaltyBoostEnabled: true
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