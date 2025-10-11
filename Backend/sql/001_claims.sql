-- sql/001_claims.sql
-- Persistent store for Claim / Hide

CREATE TABLE IF NOT EXISTS claims (
  host       TEXT PRIMARY KEY,      -- normalized host (lowercased, no scheme)
  owner      TEXT,                  -- email who owns the lead
  owned_at   TIMESTAMPTZ,           -- when it was owned
  hidden_by  TEXT,                  -- email who hid it (VIP)
  hidden_at  TIMESTAMPTZ            -- when it was hidden
);

-- helpful lookups
CREATE INDEX IF NOT EXISTS idx_claims_owner     ON claims(owner);
CREATE INDEX IF NOT EXISTS idx_claims_hidden_by ON claims(hidden_by);