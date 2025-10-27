DELETE FROM transactions;
DELETE FROM stakers;
DELETE FROM webhook_logs;
DELETE FROM rate_limits;
DELETE FROM platform_stats;

ALTER SEQUENCE IF EXISTS transactions_id_seq RESTART WITH 1;
