// @ts-nocheck
import Database from 'better-sqlite3';

export const db = new Database('galactly.sqlite');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  region TEXT NOT NULL,
  fp INTEGER NOT NULL DEFAULT 50,
  multipliers_json TEXT NOT NULL DEFAULT '{"verified":1.0,"alerts":1.0,"payment":1.0}',
  verified_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  cat_weights_json TEXT NOT NULL DEFAULT '{}',
  kw_weights_json  TEXT NOT NULL DEFAULT '{}',
  plat_weights_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS lead_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat TEXT NOT NULL,
  kw TEXT NOT NULL,
  platform TEXT NOT NULL,
  region TEXT NOT NULL,
  fit_user INTEGER NOT NULL,
  fit_competition INTEGER NOT NULL,
  heat TEXT NOT NULL,
  source_url TEXT,
  evidence_snippet TEXT,
  generated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  reserved_by TEXT,
  reserved_until INTEGER,
  company TEXT,
  person_handle TEXT,
  contact_email TEXT
);
CREATE INDEX IF NOT EXISTS idx_lead_state_region ON lead_pool(state, region);
CREATE INDEX IF NOT EXISTS idx_lead_expires ON lead_pool(expires_at);
CREATE TABLE IF NOT EXISTS lead_windows (
  id TEXT PRIMARY KEY,
  lead_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  reserved_until INTEGER NOT NULL,
  decision_deadline INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,
  user_id TEXT,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cooldowns (
  user_id TEXT PRIMARY KEY,
  ends_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  user_id TEXT PRIMARY KEY,
  email_on INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS abuse (
  user_id TEXT PRIMARY KEY,
  score INTEGER NOT NULL,
  last_inc_at INTEGER
);
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_profiles (
  user_id TEXT PRIMARY KEY,
  company TEXT, site TEXT, role TEXT, location TEXT,
  moq TEXT, leadtime TEXT, caps TEXT, links TEXT,
  cats_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
`);

export function upsertUser(id: string, region: 'US'|'Canada'|'Other', email?: string) {
  const now = Date.now();
  db.prepare(`INSERT INTO users(id,email,region,fp,multipliers_json,created_at)
    VALUES(@id,@email,@region,50,'{"verified":1.0,"alerts":1.0,"payment":1.0}',@now)
    ON CONFLICT(id) DO UPDATE SET region=excluded.region, email=COALESCE(excluded.email, users.email)`)
    .run({ id, email: email ?? null, region, now });
  db.prepare(`INSERT INTO user_prefs(user_id,updated_at)
    VALUES(@id,@now)
    ON CONFLICT(user_id) DO UPDATE SET updated_at=@now`)
    .run({ id, now });
}

export function insertLead(l: any) {
  db.prepare(`INSERT INTO lead_pool(cat,kw,platform,region,fit_user,fit_competition,heat,source_url,evidence_snippet,generated_at,expires_at,state,reserved_by,reserved_until,company,person_handle,contact_email)
  VALUES(@cat,@kw,@platform,@region,@fit_user,@fit_competition,@heat,@source_url,@evidence_snippet,@generated_at,@expires_at,@state,@reserved_by,@reserved_until,@company,@person_handle,@contact_email)`).run(l);
}
