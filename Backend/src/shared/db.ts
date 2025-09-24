// Backend/src/shared/db.ts
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * We keep a single Pool in global scope so hot-reloads / multiple imports
 * don’t create extra connections.
 */
function getPool(): Pool {
  const g = globalThis as unknown as { __GALACTLY_POOL__?: Pool };
  if (!g.__GALACTLY_POOL__) {
    g.__GALACTLY_POOL__ = new Pool({
      connectionString: process.env.DATABASE_URL, // works for Neon or Northflank
      // Neon & most hosted Postgres want TLS; NF add-on can too. Accept self-signed.
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PGPOOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
    });
  }
  return g.__GALACTLY_POOL__;
}

export const pool = getPool();

/**
 * Typed query helper that returns a full QueryResult so callers can use `.rows`.
 * Example:
 *   const rs = await q<{ id:number }>('select 1 as id');
 *   rs.rows[0].id
 */
export async function q<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  const client: PoolClient = await pool.connect();
  try {
    const res = await client.query<R>(text, params);
    return res; // has `.rows`
  } finally {
    client.release();
  }
}

/** Quick connectivity check */
export async function hasDb(): Promise<boolean> {
  try {
    await q("select 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the minimal schema the app expects.
 * Safe to call on every boot.
 */
export async function ensureSchema(): Promise<void> {
  await q(`
    create table if not exists leads (
      id        bigserial primary key,
      host      text        not null,
      platform  text,
      title     text,
      why_text  text,
      created   timestamptz not null default now(),
      temp      text,
      meta      jsonb
    );
  `);

  await q(`create index if not exists idx_leads_host on leads(host);`);
  await q(`create index if not exists idx_leads_created on leads(created desc);`);

  -- // Uniqueness to reduce dupes but permissive enough for inserts
  await q(`
    create unique index if not exists uniq_leads_identity
      on leads(host, coalesce(platform,''), coalesce(title,''))
  `);
}

/** Row shape helper (optional for callers to import) */
export type LeadRow = {
  id: number;
  host: string;
  platform: string | null;
  title: string | null;
  why_text: string | null;
  created: string; // ISO
  temp: string | null;
  meta: any;
};