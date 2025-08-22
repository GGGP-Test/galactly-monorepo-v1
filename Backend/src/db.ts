// Works with Neon Postgres when DATABASE_URL is set; falls back to SQLite file otherwise.
import Database from 'better-sqlite3';
import pgPkg from 'pg';
const { Pool } = pgPkg as { Pool: any };

const PG_URL = process.env.DATABASE_URL;
const usePg = !!PG_URL;

let pool: any = null;
let sqlite: Database.Database | null = null;

if (usePg) {
  pool = new Pool({
    connectionString: PG_URL,
    ssl: { rejectUnauthorized: false }, // Neon needs SSL
  });
} else {
  const file = process.env.DB_PATH || './galactly.sqlite';
  sqlite = new Database(file);
}

// Convert SQLite-style ? placeholders to $1,$2 for pg
function toPg(sql: string) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function exec(sql: string, args: any[] = []) {
  if (usePg) { await pool.query(toPg(sql), args); return; }
  return sqlite!.prepare(sql).run(...args);
}
async function one<T = any>(sql: string, args: any[] = []) {
  if (usePg) { const r = await pool.query(toPg(sql), args); return r.rows[0] as T; }
  return sqlite!.prepare(sql).get(...args) as T;
}
async function many<T = any>(sql: string, args: any[] = []) {
  if (usePg) { const r = await pool.query(toPg(sql), args); return r.rows as T[]; }
  return sqlite!.prepare(sql).all(...args) as T[];
}

// Keep the convenient db.prepare(...).get/run/all API, but async-backed.
export const db = {
  prepare(sql: string) {
    return {
      run: (...args: any[]) => exec(sql, args),
      get: <T = any>(...args: any[]) => one<T>(sql, args),
      all: <T = any>(...args: any[]) => many<T>(sql, args),
    };
  },
};

export async function initDb() {
  // ---- DDL ----
  // lead_pool + push_subs already in your app
  const createLead = usePg ? `
    CREATE TABLE IF NOT EXISTS lead_pool (
      id SERIAL PRIMARY KEY,
      cat TEXT, kw TEXT,
      platform TEXT, region TEXT,
      fit_user INTEGER, fit_competition INTEGER, heat INTEGER,
      source_url TEXT UNIQUE,
      evidence_snippet TEXT,
      generated_at BIGINT, expires_at BIGINT,
      state TEXT,
      reserved_by TEXT, reserved_until BIGINT,
      company TEXT, person_handle TEXT, contact_email TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_source ON lead_pool(source_url);
  ` : `
    CREATE TABLE IF NOT EXISTS lead_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cat TEXT, kw TEXT,
      platform TEXT, region TEXT,
      fit_user INTEGER, fit_competition INTEGER, heat INTEGER,
      source_url TEXT UNIQUE,
      evidence_snippet TEXT,
      generated_at INTEGER, expires_at INTEGER,
      state TEXT,
      reserved_by TEXT, reserved_until INTEGER,
      company TEXT, person_handle TEXT, contact_email TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_source ON lead_pool(source_url);
  `;

  const createPush = usePg ? `
    CREATE TABLE IF NOT EXISTS push_subs (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      endpoint TEXT UNIQUE,
      p256dh TEXT,
      auth TEXT,
      created_at BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS push_subs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      endpoint TEXT UNIQUE,
      p256dh TEXT,
      auth TEXT,
      created_at INTEGER
    );
  `;

  // Minimal tables used by routes in index.ts
  const createUsers = usePg ? `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      region TEXT,
      email TEXT,
      fp INTEGER DEFAULT 50,
      multipliers_json TEXT DEFAULT '{"verified":1.0,"alerts":1.0,"payment":1.0}',
      verified_at BIGINT,
      created_at BIGINT,
      updated_at BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      region TEXT,
      email TEXT,
      fp INTEGER DEFAULT 50,
      multipliers_json TEXT DEFAULT '{"verified":1.0,"alerts":1.0,"payment":1.0}',
      verified_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
  `;

  const createAlerts = usePg ? `
    CREATE TABLE IF NOT EXISTS alerts (
      user_id TEXT PRIMARY KEY,
      email_on INTEGER DEFAULT 0,
      created_at BIGINT,
      updated_at BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS alerts (
      user_id TEXT PRIMARY KEY,
      email_on INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    );
  `;

  const createCooldowns = usePg ? `
    CREATE TABLE IF NOT EXISTS cooldowns (
      user_id TEXT PRIMARY KEY,
      ends_at BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS cooldowns (
      user_id TEXT PRIMARY KEY,
      ends_at INTEGER
    );
  `;

  const createAbuse = usePg ? `
    CREATE TABLE IF NOT EXISTS abuse (
      user_id TEXT PRIMARY KEY,
      score INTEGER DEFAULT 0,
      last_inc_at BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS abuse (
      user_id TEXT PRIMARY KEY,
      score INTEGER DEFAULT 0,
      last_inc_at INTEGER
    );
  `;

  const createPrefs = usePg ? `
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id TEXT PRIMARY KEY,
      cat_weights_json TEXT DEFAULT '{}',
      kw_weights_json  TEXT DEFAULT '{}',
      plat_weights_json TEXT DEFAULT '{}',
      updated_at BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id TEXT PRIMARY KEY,
      cat_weights_json TEXT DEFAULT '{}',
      kw_weights_json  TEXT DEFAULT '{}',
      plat_weights_json TEXT DEFAULT '{}',
      updated_at INTEGER
    );
  `;

  const createClaims = usePg ? `
    CREATE TABLE IF NOT EXISTS claims (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER,
      user_id TEXT,
      action TEXT,
      created_at BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      user_id TEXT,
      action TEXT,
      created_at INTEGER
    );
  `;

  const createLeadWindows = usePg ? `
    CREATE TABLE IF NOT EXISTS lead_windows (
      id TEXT PRIMARY KEY,
      lead_id INTEGER,
      user_id TEXT,
      reserved_until BIGINT,
      decision_deadline BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS lead_windows (
      id TEXT PRIMARY KEY,
      lead_id INTEGER,
      user_id TEXT,
      reserved_until INTEGER,
      decision_deadline INTEGER
    );
  `;

  const createSupplierProfiles = usePg ? `
    CREATE TABLE IF NOT EXISTS supplier_profiles (
      user_id TEXT PRIMARY KEY,
      company TEXT, site TEXT, role TEXT, location TEXT,
      moq TEXT, leadtime TEXT, caps TEXT, links TEXT,
      cats_json TEXT, tags_json TEXT,
      updated_at BIGINT
    );
  ` : `
    CREATE TABLE IF NOT EXISTS supplier_profiles (
      user_id TEXT PRIMARY KEY,
      company TEXT, site TEXT, role TEXT, location TEXT,
      moq TEXT, leadtime TEXT, caps TEXT, links TEXT,
      cats_json TEXT, tags_json TEXT,
      updated_at INTEGER
    );
  `;

  const schema = [
    createLead, createPush, createUsers, createAlerts, createCooldowns,
    createAbuse, createPrefs, createClaims, createLeadWindows, createSupplierProfiles
  ].join('\n');

  for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    await exec(stmt);
  }
}

export async function upsertUser(id: string, region = 'US', email = '') {
  const now = Date.now();
  const defaultJson = '{"verified":1.0,"alerts":1.0,"payment":1.0}';

  if (usePg) {
    await exec(`
      INSERT INTO users(id, region, email, fp, multipliers_json, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT (id) DO UPDATE SET
        region = EXCLUDED.region,
        email  = EXCLUDED.email,
        updated_at = EXCLUDED.updated_at
    `, [id, region, email, 50, defaultJson, now, now]);
  } else {
    await exec(`
      INSERT INTO users(id, region, email, fp, multipliers_json, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        region = excluded.region,
        email  = excluded.email,
        updated_at = excluded.updated_at
    `, [id, region, email, 50, defaultJson, now, now]);
  }
}

export async function insertLead(lead: any) {
  const vals = [
    lead.cat ?? null,
    lead.kw ?? null,
    lead.platform ?? null,
    lead.region ?? null,
    lead.fit_user ?? null,
    lead.fit_competition ?? null,
    lead.heat ?? null,
    lead.source_url ?? null,
    lead.evidence_snippet ?? null,
    lead.generated_at ?? null,
    lead.expires_at ?? null,
    lead.state ?? 'available',
    lead.reserved_by ?? null,
    lead.reserved_until ?? null,
    lead.company ?? null,
    lead.person_handle ?? null,
    lead.contact_email ?? null,
  ];

  if (usePg) {
    await exec(
      `INSERT INTO lead_pool
       (cat,kw,platform,region,fit_user,fit_competition,heat,source_url,
        evidence_snippet,generated_at,expires_at,state,reserved_by,reserved_until,
        company,person_handle,contact_email)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (source_url) DO NOTHING`,
      vals
    );
  } else {
    await exec(
      `INSERT OR IGNORE INTO lead_pool
       (cat,kw,platform,region,fit_user,fit_competition,heat,source_url,
        evidence_snippet,generated_at,expires_at,state,reserved_by,reserved_until,
        company,person_handle,contact_email)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      vals
    );
  }
}

export default db;
