import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { checkRateLimit, RATE_LIMIT_CONFIGS } from "@shared/rate-limiter.ts";
import { checkTransactionDuplicate } from "@shared/transaction-dedup.ts";
import { verifyStakeTransaction } from "@shared/transaction-verification.ts";
import { MAX_STAKE_AMOUNT, SIGNATURE_EXPIRY_MS } from "@shared/constants.ts";

const STAKE_LOCK_DURATION = 120; // 120 seconds

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  try {
    const body = await req.json();
    const { walletAddress, amount, txSignature, type, timestamp } = body;

    console.log('Record stake request:', { walletAddress, amount, txSignature, type, timestamp });

    if (!walletAddress || !amount || !txSignature || !type) {
      const errorMsg = `Missing required fields: ${!walletAddress ? 'walletAddress ' : ''}${!amount ? 'amount ' : ''}${!txSignature ? 'txSignature ' : ''}${!type ? 'type' : ''}`;
      console.error(errorMsg);
      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate timestamp (5-minute expiry)
    if (timestamp) {
      const requestTime = new Date(timestamp).getTime();
      const now = Date.now();
      if (now - requestTime > SIGNATURE_EXPIRY_MS) {
        console.error('Signature expired:', { timestamp, now, diff: now - requestTime });
        return new Response(
          JSON.stringify({ error: 'Signature expired. Please try again.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Validate amount limits
    if (type === 'stake' && parseFloat(amount) > MAX_STAKE_AMOUNT) {
      console.error('Amount exceeds maximum:', amount);
      return new Response(
        JSON.stringify({ error: `Maximum stake amount is ${MAX_STAKE_AMOUNT} AURACLE` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      const errorMsg = `Missing Supabase configuration`;
      console.error(errorMsg, { supabaseUrl: !!supabaseUrl, supabaseKey: !!supabaseKey });
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

    // CRITICAL: Verify on-chain transaction BEFORE acquiring lock
    if (type === 'stake') {
      console.log('Verifying on-chain transaction...');
      const verificationResult = await verifyStakeTransaction(
        txSignature,
        walletAddress,
        parseFloat(amount)
      );

      if (!verificationResult.isValid) {
        console.error('Transaction verification failed:', verificationResult.error);
        return new Response(
          JSON.stringify({ 
            error: verificationResult.error || 'Transaction verification failed' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Transaction verified successfully:', verificationResult);
    }

    // ATOMIC LOCK CHECK AND SET for stake operations
    if (type === 'stake') {
      const lockUntil = new Date(Date.now() + STAKE_LOCK_DURATION * 1000).toISOString();
      
      const { data: lockResult, error: lockError } = await supabaseClient.rpc('set_stake_lock', {
        p_wallet_address: walletAddress,
        p_lock_until: lockUntil
      });

      if (lockError || !lockResult) {
        console.log('Failed to acquire stake lock:', lockError?.message || 'Lock already exists');
        return new Response(
          JSON.stringify({ error: 'Stake already in progress. Please wait and try again.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Stake lock acquired until:', lockUntil);
    }

    let operationSucceeded = false;

    try {
      // Fetch current staker data AFTER lock is set
      const { data: existingStaker, error: fetchError } = await supabaseClient
        .from('stakers')
        .select('staked_amount, first_staked_at')
        .eq('wallet_address', walletAddress)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching staker:', fetchError);
        throw new Error(`Failed to fetch staker: ${fetchError.message}`);
      }

      const newStakedAmount = (parseFloat(existingStaker?.staked_amount || 0) + amount).toString();
      const now = new Date().toISOString();

      if (existingStaker) {
        await supabaseClient
          .from('stakers')
          .update({ 
            staked_amount: newStakedAmount,
            last_updated: now,
            stake_locked_until: null,
            first_staked_at: existingStaker.first_staked_at || now
          })
          .eq('wallet_address', walletAddress);
      } else {
        await supabaseClient
          .from('stakers')
          .insert({
            wallet_address: walletAddress,
            staked_amount: newStakedAmount,
            pending_rewards: 0,
            first_staked_at: now,
            last_updated: now,
            created_at: now
          });
      }

      operationSucceeded = true;

      // Insert transaction record
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

    } catch (innerError) {
      // ONLY release lock if operation did NOT succeed
      if (!operationSucceeded && type === 'stake') {
        console.log('Releasing stake lock due to error');
        await supabaseClient
          .from('stakers')
          .update({ stake_locked_until: null })
          .eq('wallet_address', walletAddress);
      }
      
      throw innerError;
    }

  } catch (error) {
    console.error('Record stake error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});