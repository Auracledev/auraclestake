import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { checkRateLimit, RATE_LIMIT_CONFIGS } from "@shared/rate-limiter.ts";
import { checkTransactionDuplicate } from "@shared/transaction-dedup.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { walletAddress, amount, txSignature, type } = body;

    console.log('Record stake request:', { walletAddress, amount, txSignature, type });

    if (!walletAddress || !amount || !txSignature || !type) {
      const errorMsg = `Missing required fields: ${!walletAddress ? 'walletAddress ' : ''}${!amount ? 'amount ' : ''}${!txSignature ? 'txSignature ' : ''}${!type ? 'type' : ''}`;
      console.error(errorMsg);
      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY')!;

    if (!supabaseUrl || !supabaseKey) {
      const errorMsg = `Missing Supabase configuration`;
      console.error(errorMsg);
      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    // Check rate limit
    const rateLimitResult = await checkRateLimit(
      supabaseClient,
      `stake:${walletAddress}`,
      RATE_LIMIT_CONFIGS.stake
    );

    if (!rateLimitResult.allowed) {
      return new Response(
        JSON.stringify({ 
          error: `Rate limit exceeded. Please try again in ${rateLimitResult.retryAfter} seconds.` 
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          } 
        }
      );
    }

    // Check for duplicate transaction
    const dedupResult = await checkTransactionDuplicate(supabaseClient, txSignature);
    
    if (dedupResult.isDuplicate) {
      console.log('Duplicate transaction detected:', txSignature);
      return new Response(
        JSON.stringify({ 
          error: 'Transaction already processed',
          existingTransaction: dedupResult.existingTx
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const maxRetries = 3;
    let retryCount = 0;
    let success = false;
    let newStakedAmount = 0;

    while (retryCount < maxRetries && !success) {
      try {
        const { data: existingStaker, error: fetchError } = await supabaseClient
          .from('stakers')
          .select('*')
          .eq('wallet_address', walletAddress)
          .maybeSingle();

        if (fetchError) {
          console.error('Error fetching staker:', fetchError);
          throw new Error(`Failed to fetch staker: ${fetchError.message}`);
        }

        const currentVersion = existingStaker?.version || 0;

        if (type === 'stake') {
          newStakedAmount = (existingStaker?.staked_amount || 0) + parseFloat(amount);
        } else if (type === 'unstake') {
          const currentStaked = existingStaker?.staked_amount || 0;
          if (parseFloat(amount) > currentStaked) {
            throw new Error(`Insufficient staked balance. You have ${currentStaked} AURACLE staked.`);
          }
          newStakedAmount = Math.max(0, currentStaked - parseFloat(amount));
        }

        if (existingStaker) {
          const { data: updateData, error: updateError } = await supabaseClient
            .from('stakers')
            .update({ 
              staked_amount: newStakedAmount,
              last_updated: new Date().toISOString(),
              version: currentVersion + 1
            })
            .eq('wallet_address', walletAddress)
            .eq('version', currentVersion)
            .select();

          if (updateError) {
            console.error('Error updating staker:', updateError);
            throw new Error(`Failed to update staker: ${updateError.message}`);
          }

          if (!updateData || updateData.length === 0) {
            retryCount++;
            console.log(`Version conflict detected, retry ${retryCount}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
            continue;
          }
        } else {
          const { error: insertError } = await supabaseClient
            .from('stakers')
            .insert({ 
              wallet_address: walletAddress,
              staked_amount: newStakedAmount,
              version: 1
            });

          if (insertError) {
            if (insertError.code === '23505') {
              retryCount++;
              console.log(`Duplicate key detected, retry ${retryCount}/${maxRetries}`);
              await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
              continue;
            }
            console.error('Error inserting staker:', insertError);
            throw new Error(`Failed to insert staker: ${insertError.message}`);
          }
        }

        success = true;
      } catch (error) {
        if (retryCount >= maxRetries - 1) {
          throw error;
        }
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
      }
    }

    if (!success) {
      throw new Error('Failed to update staker after multiple retries due to concurrent modifications');
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