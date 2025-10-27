CREATE TABLE IF NOT EXISTS stakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  staked_amount NUMERIC NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('stake', 'unstake', 'reward')),
  amount NUMERIC NOT NULL,
  token TEXT NOT NULL,
  tx_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  distribution_date DATE NOT NULL,
  tx_signature TEXT,
  distributed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_staked NUMERIC NOT NULL DEFAULT 0,
  vault_sol_balance NUMERIC NOT NULL DEFAULT 0,
  weekly_reward_pool NUMERIC NOT NULL DEFAULT 0,
  number_of_stakers INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_wallet TEXT NOT NULL,
  action_type TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO platform_stats (total_staked, vault_sol_balance, weekly_reward_pool, number_of_stakers)
VALUES (0, 0, 0, 0)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_stakers_wallet ON stakers(wallet_address);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rewards_wallet ON rewards(wallet_address);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed ON webhook_logs(processed, created_at);

alter publication supabase_realtime add table stakers;
alter publication supabase_realtime add table transactions;
alter publication supabase_realtime add table platform_stats;
alter publication supabase_realtime add table webhook_logs;
