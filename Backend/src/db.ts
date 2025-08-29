import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

// --- PG pool (Neon-compatible) ---
const { DATABASE_URL } = process.env as { DATABASE_URL?: string };
if (!DATABASE_URL) console.warn('[db] DATABASE_URL is not set.');

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function q<T = any>(text: string, params?: any[]) {
  return pool.query<T>(text, params as any);
}

// Try to load schema.sql from common build locations; if missing, apply a minimal inline schema.
export async function migrate() {
  try {
    const candidates = [
      path.resolve(__dirname, 'schema.sql'),              // when copied into dist/
      path.resolve(process.cwd(), 'dist', 'schema.sql'),  // Dockerfile copied
      path.resolve(process.cwd(), 'src', 'schema.sql'),   // dev mode
    ];

    let schemaPath = '';
    for (const p of candidates) {
      if (fs.existsSync(p)) { schemaPath = p; break; }
    }

    if (schemaPath) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      if (sql.trim()) await q(sql);
      console.log('[db] schema applied from', schemaPath.replace(process.cwd(), '.'));
      return;
    }

    console.warn('[db] schema.sql not found — applying minimal inline schema');
    await q(`
      CREATE TABLE IF NOT EXISTS app_user (
        id TEXT PRIMARY KEY,
        region TEXT,
        email TEXT,
        alerts BOOLEAN DEFAULT false,
        user_prefs JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

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
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS claim_window (
        window_id TEXT PRIMARY KEY,
        lead_id BIGINT REFERENCES lead_pool(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
        reserved_until TIMESTAMPTZ
      );

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

      CREATE TABLE IF NOT EXISTS model_state (
        segment TEXT PRIMARY KEY,
        weights JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      INSERT INTO model_state(segment, weights)
      SELECT 'global', '{"coeffs":{"recency":0.4,"platform":1.0,"domain":0.5,"intent":0.6,"histCtr":0.3,"userFit":1.0},"platforms":{},"badDomains":[]}'::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM model_state WHERE segment='global');
    `);
  } catch (e) {
    console.error('[db] migrate error', e);
    throw e;
  }
}

export async function healthCheck() {
  try {
    const r = await q<{ ok: number }>('SELECT 1 as ok');
    return r.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function closePool() {
  await pool.end();
}
