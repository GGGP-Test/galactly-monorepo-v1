import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || '';

let pool: Pool | null = null;

// Build-time safe: don't throw during import
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

export async function q<T = any>(sql: string, params: any[] = []) {
  if (!pool) throw new Error('DB not configured: set DATABASE_URL');
  return pool.query<T>(sql, params);
}

export async function ensureSchema() {
  if (!pool) return false;
  await q(`
    create table if not exists lead_pool (
      id           bigserial primary key,
      host         text not null unique,
      platform     text not null default 'web',
      title        text,
      why          text,
      heat         int  not null default 60,
      created_at   timestamptz not null default now()
    );
  `);
  return true;
}

export function hasDb() { return !!pool; }