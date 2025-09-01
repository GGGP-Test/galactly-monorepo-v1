
CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  region TEXT,
  email TEXT,
  alerts BOOLEAN DEFAULT false,
  user_prefs JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- BRANDS (optional; used by future collectors)
CREATE TABLE IF NOT EXISTS brand (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  domain TEXT UNIQUE,
  sector TEXT,
  geo_hint TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- SIGNALS (optional; future-proof for vendor-intake/ad/pdp signals)
CREATE TABLE IF NOT EXISTS signal (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT REFERENCES brand(id) ON DELETE CASCADE,
  type TEXT,              -- rfq_page | supplier_page_change | ad_surge | restock_post | pdp_change | new_sku | retail_expansion
  url TEXT,
  ts TIMESTAMPTZ DEFAULT now(),
  payload JSONB
);
CREATE INDEX IF NOT EXISTS idx_signal_brand_time ON signal(brand_id, ts DESC);

-- LEAD POOL (what the feed shows)
CREATE TABLE IF NOT EXISTS lead_pool (
  id BIGSERIAL PRIMARY KEY,
  -- optional link to brand; nullable for generic sources
  brand_id BIGINT REFERENCES brand(id) ON DELETE SET NULL,

  -- categorization + scoring
  cat TEXT,
  kw TEXT[],
  platform TEXT,          -- brandintake | demo | rss | social | cse | ...
  fit_user INTEGER,
  heat INTEGER DEFAULT 50,

  -- payload
  source_url TEXT UNIQUE,
  title TEXT,
  snippet TEXT,

  -- lifecycle
  ttl TIMESTAMPTZ,
  state TEXT DEFAULT 'available',   -- available | reserved | owned
  reserved_by TEXT,
  reserved_at TIMESTAMPTZ,
  owned_by TEXT,
  owned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_state_time ON lead_pool(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_platform ON lead_pool(platform);

-- CLAIM WINDOWS (short hold while user decides)
CREATE TABLE IF NOT EXISTS claim_window (
  window_id TEXT PRIMARY KEY,
  lead_id BIGINT REFERENCES lead_pool(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  reserved_until TIMESTAMPTZ
);

-- EVENTS (impression/click/like/dislike/mute_domain/claim/own)
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

-- MODEL STATE (weights for ranking)
CREATE TABLE IF NOT EXISTS model_state (
  segment TEXT PRIMARY KEY,
  weights JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- default weights (insert once)
INSERT INTO model_state(segment, weights)
SELECT 'global', '{"coeffs":{"recency":0.4,"platform":1.0,"domain":0.5,"intent":0.6,"histCtr":0.3,"userFit":1.0},"platforms":{},"badDomains":[]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM model_state WHERE segment='global');

-- === Reviews cache (idempotent) ===
CREATE TABLE IF NOT EXISTS review_cache (
  domain TEXT PRIMARY KEY,
  rating NUMERIC,
  count INTEGER,
  pkg_mentions INTEGER,
  last_checked TIMESTAMPTZ DEFAULT now(),
  source JSONB
);
CREATE INDEX IF NOT EXISTS idx_review_checked ON review_cache(last_checked DESC);


-- enrichment columns (forward-compatible)
ALTER TABLE IF EXISTS lead_pool
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_handle TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB,
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_lead_enriched ON lead_pool(last_enriched_at DESC);
