import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "@shared/cors.ts";
import { VAULT_WALLET } from "@shared/constants.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_KEY') ?? ''
    );

    await supabaseClient
      .from('webhook_logs')
      .insert({
        event_type: payload.type || 'unknown',
        payload: payload,
        processed: false
      });

    if (payload.type === 'TRANSFER' && payload.nativeTransfers) {
      for (const transfer of payload.nativeTransfers) {
        if (transfer.toUserAccount === VAULT_WALLET) {
          const solAmount = transfer.amount / 1e9;
          
          const { data: stats } = await supabaseClient
            .from('platform_stats')
            .select('vault_sol_balance')
            .single();

          const newBalance = (stats?.vault_sol_balance || 0) + solAmount;

          await supabaseClient
            .from('platform_stats')
            .update({ 
              vault_sol_balance: newBalance,
              last_updated: new Date().toISOString()
            })
            .eq('id', stats?.id);

          await supabaseClient
            .from('webhook_logs')
            .update({ processed: true, processed_at: new Date().toISOString() })
            .eq('payload->signature', payload.signature);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
