import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { walletAddress, amount, txSignature, type } = await req.json();

    if (!walletAddress || !amount || !txSignature || !type) {
      throw new Error('Missing required fields');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_KEY') ?? ''
    );

    const { data: existingStaker } = await supabaseClient
      .from('stakers')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();

    let newStakedAmount = 0;
    if (type === 'stake') {
      newStakedAmount = (existingStaker?.staked_amount || 0) + parseFloat(amount);
    } else if (type === 'unstake') {
      newStakedAmount = Math.max(0, (existingStaker?.staked_amount || 0) - parseFloat(amount));
    }

    if (existingStaker) {
      await supabaseClient
        .from('stakers')
        .update({ 
          staked_amount: newStakedAmount,
          last_updated: new Date().toISOString()
        })
        .eq('wallet_address', walletAddress);
    } else {
      await supabaseClient
        .from('stakers')
        .insert({ 
          wallet_address: walletAddress,
          staked_amount: newStakedAmount
        });
    }

    await supabaseClient
      .from('transactions')
      .insert({
        wallet_address: walletAddress,
        type: type,
        amount: parseFloat(amount),
        token: 'AURACLE',
        tx_signature: txSignature,
        status: 'completed'
      });

    const { data: allStakers } = await supabaseClient
      .from('stakers')
      .select('staked_amount');

    const totalStaked = allStakers?.reduce((sum, s) => sum + parseFloat(s.staked_amount), 0) || 0;
    const numberOfStakers = allStakers?.filter(s => parseFloat(s.staked_amount) > 0).length || 0;

    await supabaseClient
      .from('platform_stats')
      .update({ 
        total_staked: totalStaked,
        number_of_stakers: numberOfStakers,
        last_updated: new Date().toISOString()
      });

    return new Response(
      JSON.stringify({ success: true, newStakedAmount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
