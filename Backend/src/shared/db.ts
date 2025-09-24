// Backend/src/shared/db.ts
import { Pool, PoolClient } from "pg";

/**
 * One env name to rule them all.
 * Put your Neon (or Northflank) connection string in DATABASE_URL.
 * If you later switch providers, just change the secret—no code changes.
 */
const connectionString =
  process.env.DATABASE_URL ||
  process.env.NF_DATABASE_URL || // optional alias
  process.env.NEON_DATABASE_URL; // optional alias

if (!connectionString) {
  // Fail fast so we notice mis-config at boot
  throw new Error("DATABASE_URL is not set");
}

// Neon and many managed PGs require TLS. NF add-on can also use TLS.
// Being permissive here avoids cert headaches in containers.
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// --- tiny helpers we export because other files import them ---

export async function hasDb(): Promise<boolean> {
  try {
    const r = await pool.query("select 1");
    return r.rowCount === 1;
  } catch {
    return false;
  }
}

/**
 * Idempotent schema creator. Safe to call on every boot.
 * Keeps it minimal so we compile even if other code imports ensureSchema().
 */
export async function ensureSchema(): Promise<void> {
  const sql = `
    create table if not exists leads (
      id            bigserial primary key,
      host          text not null,
      platform      text,
      title         text,
      why_text      text,
      temp          text,
      created       timestamptz not null default now()
    );

    create index if not exists leads_host_created_idx
      on leads (host, created desc);
  `;
  await pool.query(sql);
}

export async function query<T = any>(text: string, params?: any[]) {
  return pool.query<T>(text, params);
}

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    try { await client.query("rollback"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export { pool };
export default { pool, query, withTx, ensureSchema, hasDb };