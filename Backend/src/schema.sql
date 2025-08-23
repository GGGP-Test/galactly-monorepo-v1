-- v4: telemetry + model state + user prefs
CREATE TABLE IF NOT EXISTS event_log (
id BIGSERIAL PRIMARY KEY,
user_id TEXT,
lead_id BIGINT,
event_type TEXT, -- impression | click | claim | own | dismiss | like | dislike | mute_domain
created_at TIMESTAMPTZ DEFAULT now(),
meta JSONB
);
CREATE INDEX IF NOT EXISTS idx_event_lead ON event_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_event_user ON event_log(user_id);
CREATE INDEX IF NOT EXISTS idx_event_type_time ON event_log(event_type, created_at DESC);


CREATE TABLE IF NOT EXISTS model_state (
segment TEXT PRIMARY KEY, -- e.g. 'global' or 'sector:food'
weights JSONB NOT NULL, -- { coeffs:{recency,platform,domain,intent,histCtr,userFit}, platforms:{}, badDomains:[] }
updated_at TIMESTAMPTZ DEFAULT now()
);


ALTER TABLE app_user
ADD COLUMN IF NOT EXISTS user_prefs JSONB DEFAULT '{}'::jsonb; -- { muteDomains:[], boostKeywords:[], preferredCats:[] }


-- seed a default model_state if missing (safe to run repeatedly)
INSERT INTO model_state(segment, weights)
SELECT 'global', '{"coeffs":{"recency":0.4,"platform":1.0,"domain":0.5,"intent":0.6,"histCtr":0.3,"userFit":1.0},"platforms":{},"badDomains":[]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM model_state WHERE segment='global');
