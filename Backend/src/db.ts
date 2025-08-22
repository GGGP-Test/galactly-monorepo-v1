// Backend/src/db.ts
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
    ssl: { rejectUnauthorized: false }, // Neon requires SSL
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
  if (usePg) { const r = await pool.query(toPg(sql), args); return (r.rows[0] as T) || null; }
  return (sqlite!.prepare(sql).get(...args) as T) ?? null;
}
async function many<T = any>(sql: string, args: any[] = []) {
  if (usePg) { const r = await pool.query(toPg(sql), args); return (r.rows as T[]) ?? []; }
  return (sqlite!.prepare(sql).all(...args) as T[]) ?? [];
}

// Keep the same API shape but NOTE: these are async now.
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
  // Minimal bootstrap; your Neon already has full schema from the SQL you ran.
  // We only ensure lead_pool & push_subs exist for local SQLite fallback.
  const createLead = `
    CREATE TABLE IF NOT EXISTS lead_pool (
      id ${usePg ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePg ? '' : 'AUTOINCREMENT'},
      cat TEXT, kw TEXT,
      platform TEXT, region TEXT,
      fit_user INTEGER, fit_competition INTEGER, heat INTEGER,
      source_url TEXT UNIQUE,
      evidence_snippet TEXT,
      generated_at ${usePg ? 'BIGINT' : 'INTEGER'}, expires_at ${usePg ? 'BIGINT' : 'INTEGER'},
      state TEXT,
      reserved_by TEXT, reserved_until ${usePg ? 'BIGINT' : 'INTEGER'},
      company TEXT, person_handle TEXT, contact_email TEXT
    );
  `;
  const idxLead = `CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_source ON lead_pool(source_url);`;

  const createPush = `
    CREATE TABLE IF NOT EXISTS push_subs (
      id ${usePg ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePg ? '' : 'AUTOINCREMENT'},
      user_id TEXT,
      endpoint TEXT UNIQUE,
      p256dh TEXT,
      auth TEXT,
      created_at ${usePg ? 'BIGINT' : 'INTEGER'}
    );
  `;

  for (const stmt of [createLead, idxLead, createPush]) {
    await exec(stmt);
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

// used by /api/v1/gate
export async function upsertUser(id: string, region = 'US', email = '') {
  const now = Date.now();
  const defaultMult = '{"verified":1.0,"alerts":1.0,"payment":1.0}';
  await exec(
    `INSERT INTO users(id, region, email, fp, multipliers_json, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       region=excluded.region, email=excluded.email, updated_at=excluded.updated_at`,
    [id, region, email, 50, defaultMult, now, now]
  );
}

export default db;
