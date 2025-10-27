ALTER TABLE stakers ADD COLUMN IF NOT EXISTS first_staked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stakers_first_staked_at ON stakers(first_staked_at);

alter publication supabase_realtime add table stakers;
