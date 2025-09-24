// src/shared/db.ts
import { Pool, QueryConfig, QueryResult } from "pg";

/**
 * We use ONE env var only.
 * Point DATABASE_URL at your Postgres (Northflank add-on or Neon).
 */
const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.NF_DATABASE_URL || // optional fallback if you set it
  process.env.NEON_DATABASE_URL; // optional fallback if you set it

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Put your Postgres connection string in the service env."
  );
}

/**
 * Some hosted PGs require TLS (Neon, etc). Northflank can, too, if TLS is enabled.
 * Toggle with PGSSL=true or auto-detect by URL.
 */
const needSSL =
  process.env.PGSSL === "true" ||
  /neon\.tech|render\.com|supabase\.co|amazonaws\.com/i.test(DATABASE_URL);

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: needSSL ? { rejectUnauthorized: false } : undefined,
  // keep tiny to avoid exhausting free tiers
  max: Number(process.env.PG_MAX ?? 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export type SQL = string | QueryConfig<any[]>;

/**
 * Canonical query helper:
 * - Accepts text + params or a QueryConfig
 * - Returns a shape your handlers expect: { rows }
 */
export async function q<T = any>(
  sql: SQL,
  params?: any[]
): Promise<{ rows: T[] }> {
  const res: QueryResult = Array.isArray(params)
    ? await pool.query(sql as string, params)
    : await pool.query(sql as any);

  return { rows: res.rows as T[] };
}

/** Get a single row or null. */
export async function one<T = any>(
  sql: SQL,
  params?: any[]
): Promise<T | null> {
  const { rows } = await q<T>(sql, params);
  return rows.length ? (rows[0] as T) : null;
}

/** Quick health probe used by /healthz. */
export async function hasDb(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Idempotent schema bootstrap for leads storage.
 * Safe to call at startup; it won't drop or replace anything.
 */
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    create table if not exists leads (
      id          bigserial primary key,
      host        text not null,
      platform    text,
      title       text,
      why_text    text,
      temp        text,
      created     timestamptz not null default now()
    );
    create index if not exists leads_host_created_idx on leads(host, created desc);
  `);
}