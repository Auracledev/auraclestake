ALTER TABLE stakers ADD COLUMN IF NOT EXISTS pending_rewards NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_stakers_pending_rewards ON stakers(pending_rewards);
