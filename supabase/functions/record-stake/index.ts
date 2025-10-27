import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { walletAddress, amount, txSignature, type } = await req.json();

    console.log('Record stake request:', { walletAddress, amount, txSignature, type });

    if (!walletAddress || !amount || !txSignature || !type) {
      throw new Error('Missing required fields');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_KEY') ?? ''
    );

    const { data: existingStaker, error: fetchError } = await supabaseClient
      .from('stakers')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching staker:', fetchError);
      throw new Error(`Failed to fetch staker: ${fetchError.message}`);
    }

    console.log('Existing staker:', existingStaker);

    let newStakedAmount = 0;
    if (type === 'stake') {
      newStakedAmount = (existingStaker?.staked_amount || 0) + parseFloat(amount);
    } else if (type === 'unstake') {
      newStakedAmount = Math.max(0, (existingStaker?.staked_amount || 0) - parseFloat(amount));
    }

    console.log('New staked amount:', newStakedAmount);

    if (existingStaker) {
      const { error: updateError } = await supabaseClient
        .from('stakers')
        .update({ 
          staked_amount: newStakedAmount,
          last_updated: new Date().toISOString()
        })
        .eq('wallet_address', walletAddress);

      if (updateError) {
        console.error('Error updating staker:', updateError);
        throw new Error(`Failed to update staker: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await supabaseClient
        .from('stakers')
        .insert({ 
          wallet_address: walletAddress,
          staked_amount: newStakedAmount
        });

      if (insertError) {
        console.error('Error inserting staker:', insertError);
        throw new Error(`Failed to insert staker: ${insertError.message}`);
      }
    }

    const { error: txError } = await supabaseClient
      .from('transactions')
      .insert({
        wallet_address: walletAddress,
        type: type,
        amount: parseFloat(amount),
        token: 'AURACLE',
        tx_signature: txSignature,
        status: 'completed'
      });

    if (txError) {
      console.error('Error inserting transaction:', txError);
      throw new Error(`Failed to insert transaction: ${txError.message}`);
    }

    // Recalculate platform stats
    const { data: allStakers, error: statsError } = await supabaseClient
      .from('stakers')
      .select('staked_amount');

    if (statsError) {
      console.error('Error fetching all stakers:', statsError);
      throw new Error(`Failed to fetch stakers for stats: ${statsError.message}`);
    }

    const totalStaked = allStakers?.reduce((sum, s) => sum + parseFloat(s.staked_amount), 0) || 0;
    const numberOfStakers = allStakers?.filter(s => parseFloat(s.staked_amount) > 0).length || 0;

    const { data: existingStats } = await supabaseClient
      .from('platform_stats')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (existingStats) {
      const { error: updateStatsError } = await supabaseClient
        .from('platform_stats')
        .update({ 
          total_staked: totalStaked,
          number_of_stakers: numberOfStakers,
          last_updated: new Date().toISOString()
        })
        .eq('id', existingStats.id);

      if (updateStatsError) {
        console.error('Error updating stats:', updateStatsError);
      }
    } else {
      const { error: insertStatsError } = await supabaseClient
        .from('platform_stats')
        .insert({ 
          total_staked: totalStaked,
          number_of_stakers: numberOfStakers,
          vault_sol_balance: 0,
          weekly_reward_pool: 0
        });

      if (insertStatsError) {
        console.error('Error inserting stats:', insertStatsError);
      }
    }

    console.log('Record stake success');

    return new Response(
      JSON.stringify({ success: true, newStakedAmount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Record stake error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});