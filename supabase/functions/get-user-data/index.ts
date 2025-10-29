import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.87.6';
import { getAccount, getAssociatedTokenAddress } from 'npm:@solana/spl-token@0.3.9';
import { VAULT_ADDRESS, AURACLE_MINT } from "@shared/constants.ts";

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;
const AURACLE_DECIMALS = 6;

function calculateStakingDays(firstStakedAt: string): number {
  const firstStaked = new Date(firstStakedAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - firstStaked.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function getLoyaltyMultiplier(firstStakedAt: string | null): number {
  if (!firstStakedAt) return 1.0;
  
  const stakingDays = calculateStakingDays(firstStakedAt);
  
  if (stakingDays >= 90) return 1.5;
  if (stakingDays >= 60) return 1.4;
  if (stakingDays >= 30) return 1.3;
  if (stakingDays >= 7) return 1.1;
  return 1.0;
}

Deno.serve(async (req) => {
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    const { walletAddress } = await req.json();

    if (!walletAddress) {
      return new Response(
        JSON.stringify({ error: 'Missing walletAddress parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing environment variables:', { 
        hasUrl: !!supabaseUrl, 
        hasKey: !!supabaseKey 
      });
      return new Response(
        JSON.stringify({ 
          error: 'Server configuration error',
          details: 'Missing required environment variables'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Fetch staker data from database (this is the user's staked amount)
    const { data: staker, error: stakerError } = await supabaseClient
      .from('stakers')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (stakerError) {
      console.error('Staker query error:', stakerError);
      return new Response(
        JSON.stringify({ 
          error: 'Database error',
          details: stakerError.message,
          code: stakerError.code 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch transactions
    const { data: transactions, error: txError } = await supabaseClient
      .from('transactions')
      .select('*')
      .eq('wallet_address', walletAddress)
      .order('created_at', { ascending: false })
      .limit(10);

    if (txError) {
      console.error('Transactions query error:', txError);
      return new Response(
        JSON.stringify({ 
          error: 'Database error',
          details: txError.message,
          code: txError.code 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate rewards using WEIGHTED STAKES
    let estimatedDailyRewards = '0';
    let pendingRewards = 0;
    let rewardsPerSecond = 0;

    if (staker && staker.staked_amount > 0) {
      try {
        const connection = new Connection(MAINNET_RPC, 'confirmed');
        const vaultPublicKey = new PublicKey(VAULT_ADDRESS);
        const mintPublicKey = new PublicKey(AURACLE_MINT);

        // Get real vault SOL balance from blockchain
        const vaultBalance = await connection.getBalance(vaultPublicKey);
        const vaultSOL = vaultBalance / LAMPORTS_PER_SOL;

        // Get total staked AURACLE from vault wallet on blockchain
        const vaultTokenAccount = await getAssociatedTokenAddress(
          mintPublicKey,
          vaultPublicKey
        );
        
        try {
          const accountInfo = await getAccount(connection, vaultTokenAccount);
          const totalStaked = Number(accountInfo.amount) / Math.pow(10, AURACLE_DECIMALS);

          // Fetch ALL stakers to calculate total weighted stakes
          const { data: allStakers, error: allStakersError } = await supabaseClient
            .from('stakers')
            .select('wallet_address, staked_amount, first_staked_at')
            .gt('staked_amount', 0);

          if (allStakersError) {
            console.error('Error fetching all stakers:', allStakersError);
            throw allStakersError;
          }

          console.log('=== WEIGHTED REWARDS CALCULATION DEBUG ===');
          console.log('Vault SOL balance:', vaultSOL);
          console.log('Total AURACLE staked (blockchain):', totalStaked);
          console.log('Number of active stakers:', allStakers?.length || 0);

          // Calculate total weighted stakes
          let totalWeightedStakes = 0;
          for (const s of allStakers || []) {
            const multiplier = getLoyaltyMultiplier(s.first_staked_at);
            const weightedAmount = parseFloat(s.staked_amount) * multiplier;
            totalWeightedStakes += weightedAmount;
            
            console.log(`Staker ${s.wallet_address.slice(0, 8)}... : ${s.staked_amount} AURACLE × ${multiplier}x = ${weightedAmount} weighted`);
          }

          console.log('Total weighted stakes:', totalWeightedStakes);

          if (totalWeightedStakes > 0) {
            // Calculate user's weighted stake
            const userStakedAmount = parseFloat(staker.staked_amount);
            const userLoyaltyMultiplier = getLoyaltyMultiplier(staker.first_staked_at);
            const userWeightedStake = userStakedAmount * userLoyaltyMultiplier;
            
            console.log('User staked amount:', userStakedAmount);
            console.log('User loyalty multiplier:', userLoyaltyMultiplier);
            console.log('User weighted stake:', userWeightedStake);
            
            // Calculate share based on weighted stakes
            const stakerShare = userWeightedStake / totalWeightedStakes;
            
            console.log('Staker weighted share:', stakerShare);
            
            // Formula: (weighted_stake / total_weighted_stakes) × vault_SOL × 50% distributed over 1 week
            const weeklyVaultDistribution = vaultSOL * 0.5;
            const userWeeklyReward = weeklyVaultDistribution * stakerShare;
            
            console.log('Weekly vault distribution:', weeklyVaultDistribution);
            console.log('User weekly reward:', userWeeklyReward);
            
            // Calculate per-second rate
            rewardsPerSecond = userWeeklyReward / SECONDS_PER_WEEK;
            const dailyReward = rewardsPerSecond * 86400;
            
            console.log('Rewards per second:', rewardsPerSecond);
            console.log('Daily reward:', dailyReward);
            
            estimatedDailyRewards = dailyReward.toFixed(6);
            
            // Calculate pending rewards based on time since last update
            const lastUpdated = new Date(staker.last_updated || staker.created_at);
            const now = new Date();
            const secondsSinceUpdate = (now.getTime() - lastUpdated.getTime()) / 1000;
            
            const accruedRewards = rewardsPerSecond * secondsSinceUpdate;
            pendingRewards = parseFloat(staker.pending_rewards || 0) + accruedRewards;
            
            // Update the database with new pending rewards and last_updated timestamp
            await supabaseClient
              .from('stakers')
              .update({
                pending_rewards: pendingRewards,
                last_updated: now.toISOString()
              })
              .eq('wallet_address', walletAddress);
          }
        } catch (tokenError) {
          // Token account doesn't exist yet (no stakes have been made)
          console.log('Token account not found - no stakes yet:', tokenError.message);
        }
      } catch (blockchainError) {
        console.error('Blockchain query error:', blockchainError);
        // Continue without rewards calculation
      }
    }

    return new Response(
      JSON.stringify({
        staker,
        transactions: transactions || [],
        estimatedDailyRewards,
        pendingRewards,
        rewardsPerSecond
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Get user data error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Server error',
        details: error.message,
        stack: error.stack 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});