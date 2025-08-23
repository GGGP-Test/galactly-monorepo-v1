-- Idempotent base + additive schema for Galactly (safe to run repeatedly)
source_url TEXT UNIQUE,
title TEXT,
snippet TEXT,
ttl TIMESTAMPTZ,
state TEXT DEFAULT 'available',
reserved_by TEXT,
reserved_at TIMESTAMPTZ,
owned_by TEXT,
owned_at TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE IF NOT EXISTS claim_window (
window_id TEXT PRIMARY KEY,
lead_id BIGINT REFERENCES lead_pool(id) ON DELETE CASCADE,
user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
reserved_until TIMESTAMPTZ
);


-- enrichment columns (additive)
ALTER TABLE IF EXISTS lead_pool
ADD COLUMN IF NOT EXISTS contact_email TEXT,
ADD COLUMN IF NOT EXISTS contact_handle TEXT,
ADD COLUMN IF NOT EXISTS meta JSONB,
ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_lead_enriched ON lead_pool(last_enriched_at DESC);


-- events
CREATE TABLE IF NOT EXISTS event_log (
id BIGSERIAL PRIMARY KEY,
user_id TEXT,
lead_id BIGINT,
event_type TEXT,
created_at TIMESTAMPTZ DEFAULT now(),
meta JSONB
);
CREATE INDEX IF NOT EXISTS idx_event_lead ON event_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_event_user ON event_log(user_id);
CREATE INDEX IF NOT EXISTS idx_event_type_time ON event_log(event_type, created_at DESC);


-- model weights/state
CREATE TABLE IF NOT EXISTS model_state (
segment TEXT PRIMARY KEY,
weights JSONB NOT NULL,
updated_at TIMESTAMPTZ DEFAULT now()
);


-- default weights row
INSERT INTO model_state(segment, weights)
SELECT 'global', '{"coeffs":{"recency":0.4,"platform":1.0,"domain":0.5,"intent":0.6,"histCtr":0.3,"userFit":1.0},"platforms":{},"badDomains":[]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM model_state WHERE segment='global');
