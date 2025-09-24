// Backend/src/db.ts
/* Single authoritative DB module.
   - Connection string: process.env.DATABASE_URL (Neon OR Northflank Postgres)
   - No type deps required (dynamic require avoids TS "cannot find module 'pg'")
*/

type AnyRow = Record<string, unknown>;

// Use dynamic require so tsc doesn't need the 'pg' package types at build time.
const req = (eval as unknown as (s: string) => any)('require') as any;
const { Pool } = req('pg'); // runtime dependency; install 'pg' in package.json

// ---- connection ----
const CONN = process.env.DATABASE_URL;
if (!CONN) {
  // Keep error message helpful but non-fatal for build; runtime will throw on first query.
  // eslint-disable-next-line no-console
  console.warn('[db] DATABASE_URL is not set – queries will fail until it is provided.');
}

export const pool = new Pool({
  connectionString: CONN,
  // Neon + many managed Postgres require TLS:
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX ?? 5),
  idleTimeoutMillis: 15_000,
  connectionTimeoutMillis: 8_000,
});

// Core query helper
export async function q<T = AnyRow>(sql: string, params: unknown[] = []) {
  const client = await pool.connect();
  try {
    const res = await client.query<T>(sql, params);
    return res;
  } finally {
    client.release();
  }
}

// Health check: returns true if DB answers
export async function hasDb(): Promise<boolean> {
  try {
    await q('select 1');
    return true;
  } catch {
    return false;
  }
}

// Ensure minimal schema needed by the lead ingestion & panel
export async function ensureSchema() {
  // Extensions are safe to run repeatedly
  await q(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

  // Table used by ingest + panel
  await q(`
    CREATE TABLE IF NOT EXISTS lead_pool (
      id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      cat          text,
      kw           text[],
      platform     text,
      fit_user     int,
      heat         int,
      source_url   text UNIQUE,
      title        text,
      snippet      text,
      ttl          timestamptz,
      state        text DEFAULT 'available',
      created_at   timestamptz DEFAULT now()
    );
  `);

  // Simple index for faster lookups
  await q(`CREATE INDEX IF NOT EXISTS lead_pool_ttl_idx ON lead_pool (ttl);`);
  await q(`CREATE INDEX IF NOT EXISTS lead_pool_state_idx ON lead_pool (state);`);
}

// Graceful shutdown (optional)
export async function shutdown() {
  await pool.end();
}
