-- Ensure first_staked_at column exists
ALTER TABLE stakers ADD COLUMN IF NOT EXISTS first_staked_at TIMESTAMPTZ;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_stakers_first_staked_at ON stakers(first_staked_at);
