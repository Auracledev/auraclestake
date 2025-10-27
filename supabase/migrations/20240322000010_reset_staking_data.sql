DELETE FROM transactions;
DELETE FROM rewards;
DELETE FROM stakers;
DELETE FROM webhook_logs;
DELETE FROM admin_actions;

UPDATE platform_stats 
SET total_staked = 0, 
    vault_sol_balance = 0,
    weekly_reward_pool = 0,
    number_of_stakers = 0,
    last_updated = NOW();