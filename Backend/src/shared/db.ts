// src/shared/db.ts
// Northflank Postgres helper (with safe fallback if DB isn’t configured)

let Pool: any = null;
try { ({ Pool } = require('pg')); } catch { /* optional dep */ }

const connFromEnv = () => {
  const url = process.env.DATABASE_URL;
  if (url) return { connectionString: url, ssl: { rejectUnauthorized: false } };
  const host = process.env.PGHOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
  };
};

const cfg = connFromEnv();
const pool = (Pool && cfg) ? new Pool(cfg) : null;

export async function q<T = any>(sql: string, params: any[] = []) {
  if (!pool) return { rows: [] as T[], rowCount: 0 } as any;
  return pool.query(sql, params);
}

// Minimal auto-migration (idempotent)
export async function ensureTables() {
  if (!pool) return;
  const sql = `
  create table if not exists candidate_hosts (
    host text primary key,
    seen_at timestamptz not null default now(),
    source text not null default 'mirror'
  );

  create table if not exists buyer_leads (
    id bigserial primary key,
    supplier_host text not null,
    buyer_host    text not null,
    url           text not null,
    title         text,
    why           text,
    platform      text not null default 'web',
    temperature   text not null default 'warm',
    score         int  not null default 0,
    source        text not null default 'live',
    created_at    timestamptz not null default now(),
    unique (supplier_host, buyer_host, url)
  );

  create index if not exists buyer_leads_recent_idx
    on buyer_leads (created_at desc);
  `;
  await q(sql);
}