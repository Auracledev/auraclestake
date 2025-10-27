ALTER TABLE stakers ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stakers ADD COLUMN IF NOT EXISTS pending_rewards NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_stakers_version ON stakers(wallet_address, version);

ALTER TABLE stakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to platform stats" ON platform_stats;
CREATE POLICY "Public read access to platform stats"
ON platform_stats FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Service role full access to platform stats" ON platform_stats;
CREATE POLICY "Service role full access to platform stats"
ON platform_stats FOR ALL
USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can read their own staker data" ON stakers;
CREATE POLICY "Users can read their own staker data"
ON stakers FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Service role full access to stakers" ON stakers;
CREATE POLICY "Service role full access to stakers"
ON stakers FOR ALL
USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can read their own transactions" ON transactions;
CREATE POLICY "Users can read their own transactions"
ON transactions FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Service role full access to transactions" ON transactions;
CREATE POLICY "Service role full access to transactions"
ON transactions FOR ALL
USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can read their own rewards" ON rewards;
CREATE POLICY "Users can read their own rewards"
ON rewards FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Service role full access to rewards" ON rewards;
CREATE POLICY "Service role full access to rewards"
ON rewards FOR ALL
USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to webhook logs" ON webhook_logs;
CREATE POLICY "Service role full access to webhook logs"
ON webhook_logs FOR ALL
USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to admin actions" ON admin_actions;
CREATE POLICY "Service role full access to admin actions"
ON admin_actions FOR ALL
USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS withdrawal_locks (
  wallet_address TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 seconds'
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_locks_expires ON withdrawal_locks(expires_at);

DROP POLICY IF EXISTS "Service role full access to withdrawal locks" ON withdrawal_locks;
CREATE POLICY "Service role full access to withdrawal locks"
ON withdrawal_locks FOR ALL
USING (auth.role() = 'service_role');

ALTER TABLE withdrawal_locks ENABLE ROW LEVEL SECURITY;
