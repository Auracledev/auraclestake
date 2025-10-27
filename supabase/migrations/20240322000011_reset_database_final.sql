DELETE FROM transactions;
DELETE FROM stakers;
DELETE FROM rewards;
DELETE FROM platform_stats;

INSERT INTO platform_stats (total_staked, vault_sol_balance, weekly_reward_pool, number_of_stakers, last_updated)
VALUES (0, 0, 0, 0, NOW())
ON CONFLICT DO NOTHING;