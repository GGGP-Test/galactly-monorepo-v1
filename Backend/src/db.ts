// Backend/src/db.ts (ESM/TS)
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
    ssl: { rejectUnauthorized: false },
  });
} else {
  const file = process.env.DB_PATH || './galactly.sqlite';
  sqlite = new Database(file);
}

// Replace each "?" with $1, $2, ...
function toPg(sql: string) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function exec(sql: string, args: any[] = []) {
  if (usePg) { await pool.query(toPg(sql), args); return; }
  return sqlite!.prepare(sql).run(...args);
}
async function one(sql: string, args: any[] = []) {
  if (usePg) { const r = await pool.query(toPg(sql), args); return r.rows[0]; }
  return sqlite!.prepare(sql).get(...args);
}
async function all(sql: string, args: any[] = []) {
  if (usePg) { const r = await pool.query(toPg(sql), args); return r.rows; }
  return sqlite!.prepare(sql).all(...args);
}

export const db = {
  prepare(sql: string) {
    return {
      run: (...args: any[]) => exec(sql, args),
      get: (...args: any[]) => one(sql, args),
      all: (...args: any[]) => all(sql, args),
    };
  },
};

export async function initDb() {
  const createSql = usePg ? `
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
  for (const stmt of createSql.split(';').map(s => s.trim()).filter(Boolean)) {
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

export default db;
