-- Add unstake lock column to stakers table
ALTER TABLE stakers ADD COLUMN IF NOT EXISTS unstake_locked_until TIMESTAMPTZ;

-- Add index for better performance on lock checks
CREATE INDEX IF NOT EXISTS idx_stakers_unstake_lock ON stakers(wallet_address, unstake_locked_until);