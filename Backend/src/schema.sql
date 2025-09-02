-- Galactly schema — 2025-09-02

BEGIN;

-- Users
CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  email TEXT,
  region TEXT,
  alerts BOOLEAN DEFAULT FALSE,
  user_prefs JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Leads pool (available/reserved/owned)
CREATE TABLE IF NOT EXISTS lead_pool (
  id BIGSERIAL PRIMARY KEY,
  cat TEXT,
  kw TEXT[] DEFAULT ARRAY[]::TEXT[],
  platform TEXT,
  fit_user INTEGER,
  heat INTEGER,
  source_url TEXT UNIQUE,
  title TEXT,
  snippet TEXT,
  ttl TIMESTAMPTZ,
  state TEXT DEFAULT 'available',        -- available | reserved | owned
  reserved_by TEXT,
  reserved_at TIMESTAMPTZ,
  owned_by TEXT,
  owned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_pool_state    ON lead_pool(state);
CREATE INDEX IF NOT EXISTS idx_lead_pool_created  ON lead_pool(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_pool_owned_by ON lead_pool(owned_by);
CREATE INDEX IF NOT EXISTS idx_lead_pool_reserved_by ON lead_pool(reserved_by);

-- 2-minute reservation window (Claim → Own)
CREATE TABLE IF NOT EXISTS claim_window (
  window_id UUID PRIMARY KEY,
  lead_id BIGINT REFERENCES lead_pool(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  reserved_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_claim_window_lead ON claim_window(lead_id);
CREATE INDEX IF NOT EXISTS idx_claim_window_user ON claim_window(user_id);

-- User events (like/dislike/mute/confirm etc.)
CREATE TABLE IF NOT EXISTS event_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  lead_id BIGINT,
  event_type TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  ts TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_user ON event_log(user_id);
CREATE INDEX IF NOT EXISTS idx_event_lead ON event_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_event_type ON event_log(event_type);

-- Scoring model weights
CREATE TABLE IF NOT EXISTS model_state (
  segment TEXT PRIMARY KEY,
  weights JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- seed default weights once
INSERT INTO model_state(segment, weights)
VALUES (
  'global',
  '{"coeffs":{"recency":0.4,"platform":1.0,"domain":0.5,"intent":0.6,"histCtr":0.3,"userFit":1.0},"platforms":{},"badDomains":[]}'
)
ON CONFLICT (segment) DO NOTHING;

-- Optional brand catalog for admin seeding
CREATE TABLE IF NOT EXISTS brand (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE NOT NULL,
  sector TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMIT;
