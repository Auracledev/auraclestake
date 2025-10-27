import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from 'npm:@solana/web3.js@1.87.6';
import { getAccount, getAssociatedTokenAddress } from 'npm:@solana/spl-token@0.3.9';
import { VAULT_WALLET, AURACLE_MINT } from "@shared/constants.ts";

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;
const AURACLE_DECIMALS = 6;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { walletAddress } = await req.json();

    if (!walletAddress) {
      return new Response(
        JSON.stringify({ error: 'Missing walletAddress parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_KEY');

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

    // Calculate rewards using: USER'S DATABASE STAKED AMOUNT / TOTAL BLOCKCHAIN VAULT BALANCE
    let estimatedDailyRewards = '0';
    let pendingRewards = 0;
    let rewardsPerSecond = 0;

    if (staker && staker.staked_amount > 0) {
      const connection = new Connection(MAINNET_RPC, 'confirmed');
      const vaultPublicKey = new PublicKey(VAULT_WALLET);
      const mintPublicKey = new PublicKey(AURACLE_MINT);

      // Get real vault SOL balance from blockchain
      const vaultBalance = await connection.getBalance(vaultPublicKey);
      const vaultSOL = vaultBalance / LAMPORTS_PER_SOL;

      // Get total staked AURACLE from vault wallet on blockchain
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        vaultPublicKey
      );
      const accountInfo = await getAccount(connection, vaultTokenAccount);
      const totalStaked = Number(accountInfo.amount) / Math.pow(10, AURACLE_DECIMALS);

      if (totalStaked > 0) {
        // Use the user's DATABASE staked amount (not blockchain)
        const userStakedAmount = parseFloat(staker.staked_amount);
        const stakerShare = userStakedAmount / totalStaked;
        
        // Simple formula: (your_stake / total_stake) × vault_SOL × 50% distributed over 1 week
        const weeklyVaultDistribution = vaultSOL * 0.5;
        const userWeeklyReward = weeklyVaultDistribution * stakerShare;
        
        // Calculate per-second rate
        rewardsPerSecond = userWeeklyReward / SECONDS_PER_WEEK;
        const dailyReward = rewardsPerSecond * 86400;
        
        estimatedDailyRewards = dailyReward.toFixed(6);
        
        // Calculate pending rewards based on time since last update
        const lastUpdated = new Date(staker.last_updated || staker.created_at);
        const now = new Date();
        const secondsSinceUpdate = (now.getTime() - lastUpdated.getTime()) / 1000;
        
        const accruedRewards = rewardsPerSecond * secondsSinceUpdate;
        pendingRewards = parseFloat(staker.pending_rewards || 0) + accruedRewards;
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