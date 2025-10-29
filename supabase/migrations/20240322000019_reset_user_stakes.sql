DELETE FROM stakers;
DELETE FROM transactions;

UPDATE platform_stats SET
  total_staked = 0,
  number_of_stakers = 0,
  vault_sol_balance = 0,
  weekly_reward_pool = 0,
  last_updated = NOW();