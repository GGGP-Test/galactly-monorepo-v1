// Backend/src/shared/db.ts
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

/**
 * One source of truth for the DB connection.
 * Looks for DATABASE_URL first (Neon/Northflank), then POSTGRES_URL.
 */
const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

if (!connectionString) {
  // We don't throw here so builds still succeed; runtime will surface it.
  console.warn(
    "[db] DATABASE_URL/POSTGRES_URL not set. DB calls will fail at runtime."
  );
}

/**
 * SSL:
 * - Neon generally requires SSL; Northflank addon usually works without.
 * - Set PGSSL=disable in the environment to turn SSL off explicitly.
 */
export const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === "disable" ? undefined : { rejectUnauthorized: false },
});

/**
 * Typed query helper.
 * Usage:
 *   const rows = await q<MyRow>("select * from leads where host=$1", [host])
 */
export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client?: PoolClient
): Promise<T[]> {
  const runner = client ?? pool;
  const res = (await runner.query(text, params)) as QueryResult<T>;
  return res.rows;
}

/**
 * Transaction helper.
 * Usage:
 *   await tx(async (c) => {
 *     await c.query("...");
 *     await c.query("...");
 *   })
 */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    try { await c.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    c.release();
  }
}

/** Simple connectivity probe used by health checks */
export async function hasDb(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

/** Minimal schema needed by the leads API */
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    create table if not exists leads (
      id serial primary key,
      host text not null,
      platform text not null,
      title text,
      why_text text,
      temp text,
      created timestamptz default now()
    );
    create index if not exists leads_host_idx on leads(host);
    create index if not exists leads_created_idx on leads(created);
  `);
}

/** Default export for legacy imports */
export default q;