import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { walletAddress } = await req.json();

    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: staker, error: stakerError } = await supabaseClient
      .from('stakers')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();

    const { data: transactions, error: txError } = await supabaseClient
      .from('transactions')
      .select('*')
      .eq('wallet_address', walletAddress)
      .order('created_at', { ascending: false })
      .limit(20);

    const { data: stats } = await supabaseClient
      .from('platform_stats')
      .select('*')
      .single();

    let estimatedDailyRewards = '0';
    if (staker && stats && stats.total_staked > 0) {
      const userShare = parseFloat(staker.staked_amount) / parseFloat(stats.total_staked);
      const dailyReward = (parseFloat(stats.weekly_reward_pool) / 7) * userShare;
      estimatedDailyRewards = dailyReward.toFixed(4);
    }

    return new Response(
      JSON.stringify({ 
        staker: staker || null,
        transactions: transactions || [],
        estimatedDailyRewards,
        pendingRewards: staker?.pending_rewards || 0
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