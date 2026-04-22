DROP INDEX IF EXISTS idx_trx_dedupe_hash;
CREATE INDEX idx_trx_dedupe_hash ON weekly_transactions(dedupe_hash) WHERE dedupe_hash IS NOT NULL;
