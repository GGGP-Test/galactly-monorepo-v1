-- Galactly DB schema (NF) — full file with new tables for brands & signals
-- Safe to run multiple times.

-- USERS ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  region TEXT,
  email TEXT,
  alerts BOOLEAN DEFAULT false,
  user_prefs JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- LEADS ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_pool (
  id BIGSERIAL PRIMARY KEY,
  cat TEXT,
  kw TEXT[],
  platform TEXT,
  fit_user INTEGER,
  heat INTEGER,
  source_url TEXT UNIQUE,
  title TEXT,
  snippet TEXT,
  ttl TIMESTAMPTZ,
  state TEXT DEFAULT 'available',
  reserved_by TEXT,
  reserved_at TIMESTAMPTZ,
  owned_by TEXT,
  owned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  meta JSONB,
  last_enriched_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lead_created ON lead_pool(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_state ON lead_pool(state);

-- CLAIM WINDOWS ----------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_window (
  window_id TEXT PRIMARY KEY,
  lead_id BIGINT REFERENCES lead_pool(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  reserved_until TIMESTAMPTZ
);

-- EVENTS -----------------------------------------------------------
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

-- MODEL STATE (weights) -------------------------------------------
CREATE TABLE IF NOT EXISTS model_state (
  segment TEXT PRIMARY KEY,
  weights JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO model_state(segment, weights)
SELECT 'global', '{"coeffs":{"recency":0.5,"platform":0.8,"domain":0.4,"intent":0.6,"histCtr":0.3,"userFit":1.0},"platforms":{},"badDomains":[]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM model_state WHERE segment='global');

-- NEW: BRANDS (seed lists) ----------------------------------------
-- role = 'buyer' (ICP brand) or 'vendor' (packaging company)
CREATE TABLE IF NOT EXISTS brands (
  domain TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'buyer',
  name TEXT,
  country TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brands_role ON brands(role);

-- NEW: SIGNALS (evidence events used to derive leads) --------------
-- type examples: 'supplier_page', 'rfq_hint', 'restock', 'ad_surge', 'pdp_change'
CREATE TABLE IF NOT EXISTS signals (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT REFERENCES brands(domain) ON DELETE SET NULL,
  type TEXT NOT NULL,
  url TEXT,
  ts TIMESTAMPTZ DEFAULT now(),
  data JSONB,
  UNIQUE(type, url)
);
CREATE INDEX IF NOT EXISTS idx_signals_domain_time ON signals(domain, ts DESC);
CREATE INDEX IF NOT EXISTS idx_signals_type_time ON signals(type, ts DESC);

-- Helper view: recent signals per brand (last 7 days)
CREATE OR REPLACE VIEW v_brand_recent_signals AS
SELECT domain, type, url, ts, data
FROM signals
WHERE ts > now() - interval '7 days';
