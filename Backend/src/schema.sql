CREATE TABLE IF NOT EXISTS lead_pool (
id BIGSERIAL PRIMARY KEY,
platform TEXT,
source_url TEXT UNIQUE,
title TEXT,
snippet TEXT,
created_at TIMESTAMPTZ DEFAULT now(),
state TEXT DEFAULT 'available'
);


CREATE TABLE IF NOT EXISTS model_state (
segment TEXT PRIMARY KEY,
weights JSONB NOT NULL,
updated_at TIMESTAMPTZ DEFAULT now()
);


INSERT INTO model_state(segment, weights)
SELECT 'global', '{"coeffs":{"recency":0.5,"platform":0.8,"domain":0.4,"intent":0.6,"histCtr":0.3,"userFit":1.0},"platforms":{},"badDomains":[]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM model_state WHERE segment='global');
