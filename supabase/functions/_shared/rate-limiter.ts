import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export async function checkRateLimit(
  supabaseClient: any,
  identifier: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.windowMs);

  // Clean up old rate limit records
  await supabaseClient
    .from('rate_limits')
    .delete()
    .lt('created_at', windowStart.toISOString());

  // Count requests in current window
  const { data: recentRequests, error } = await supabaseClient
    .from('rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .gte('created_at', windowStart.toISOString());

  if (error) {
    console.error('Rate limit check error:', error);
    // Fail open - allow request if we can't check rate limit
    return { allowed: true };
  }

  const requestCount = recentRequests?.length || 0;

  if (requestCount >= config.maxRequests) {
    const oldestRequest = recentRequests[0];
    const oldestTime = new Date(oldestRequest.created_at).getTime();
    const retryAfter = Math.ceil((oldestTime + config.windowMs - now.getTime()) / 1000);
    
    return { allowed: false, retryAfter };
  }

  // Record this request
  await supabaseClient
    .from('rate_limits')
    .insert({
      identifier,
      created_at: now.toISOString()
    });

  return { allowed: true };
}

export const RATE_LIMIT_CONFIGS = {
  stake: { maxRequests: 2, windowMs: 60000 }, // 2 requests per minute
  unstake: { maxRequests: 2, windowMs: 60000 }, // 2 requests per minute
  withdraw: { maxRequests: 1, windowMs: 300000 }, // 1 request per 5 minutes
  general: { maxRequests: 30, windowMs: 60000 }, // 30 requests per minute
};