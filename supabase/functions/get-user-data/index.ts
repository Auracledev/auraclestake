import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";

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

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Fetch staker data
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

    // Calculate estimated daily rewards
    const { data: platformStats } = await supabaseClient
      .from('platform_stats')
      .select('*')
      .limit(1)
      .maybeSingle();

    let estimatedDailyRewards = '0';
    if (staker && platformStats && platformStats.total_staked > 0) {
      const dailyPool = platformStats.weekly_reward_pool / 7;
      const userShare = staker.staked_amount / platformStats.total_staked;
      estimatedDailyRewards = (dailyPool * userShare).toFixed(6);
    }

    return new Response(
      JSON.stringify({
        staker,
        transactions: transactions || [],
        estimatedDailyRewards,
        pendingRewards: staker?.pending_rewards || 0
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