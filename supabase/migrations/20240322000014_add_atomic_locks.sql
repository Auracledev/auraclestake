-- Create atomic lock function for unstake
CREATE OR REPLACE FUNCTION set_unstake_lock(
  p_wallet_address TEXT,
  p_lock_until TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  current_lock TIMESTAMPTZ;
BEGIN
  -- Get current lock with row-level lock
  SELECT unstake_locked_until INTO current_lock
  FROM stakers
  WHERE wallet_address = p_wallet_address
  FOR UPDATE;
  
  -- Check if lock exists and is still valid
  IF current_lock IS NOT NULL AND current_lock > NOW() THEN
    RETURN FALSE;
  END IF;
  
  -- Set the lock
  UPDATE stakers
  SET unstake_locked_until = p_lock_until
  WHERE wallet_address = p_wallet_address;
  
  RETURN TRUE;
END;
$$;

-- Create atomic lock function for stake
CREATE OR REPLACE FUNCTION set_stake_lock(
  p_wallet_address TEXT,
  p_lock_until TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  current_lock TIMESTAMPTZ;
BEGIN
  -- Get current lock with row-level lock
  SELECT stake_locked_until INTO current_lock
  FROM stakers
  WHERE wallet_address = p_wallet_address
  FOR UPDATE;
  
  -- Check if lock exists and is still valid
  IF current_lock IS NOT NULL AND current_lock > NOW() THEN
    RETURN FALSE;
  END IF;
  
  -- Set the lock
  UPDATE stakers
  SET stake_locked_until = p_lock_until
  WHERE wallet_address = p_wallet_address;
  
  -- If staker doesn't exist, create it with lock
  IF NOT FOUND THEN
    INSERT INTO stakers (wallet_address, staked_amount, stake_locked_until)
    VALUES (p_wallet_address, 0, p_lock_until);
  END IF;
  
  RETURN TRUE;
END;
$$;

-- Add stake_locked_until column if it doesn't exist
ALTER TABLE stakers ADD COLUMN IF NOT EXISTS stake_locked_until TIMESTAMPTZ;
