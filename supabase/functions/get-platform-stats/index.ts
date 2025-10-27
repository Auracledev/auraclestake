import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Calculate stats from stakers table
    const { data: stakers, error: stakersError } = await supabaseClient
      .from('stakers')
      .select('staked_amount');

    if (stakersError) throw stakersError;

    const totalStaked = stakers?.reduce((sum, s) => sum + s.staked_amount, 0) || 0;
    const numberOfStakers = stakers?.length || 0;

    const stats = {
      total_staked: totalStaked,
      number_of_stakers: numberOfStakers,
      vault_sol_balance: 0, // This would need to be fetched from Solana
      daily_reward_pool: 0
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