// Backend/src/shared/db.ts
// One tiny helper: q(sql, params) + a cheap health check.
// Works with either NEON or Northflank Postgres. Just set DATABASE_URL.

import * as pg from 'pg';

function buildUrlFromNFEnv() {
  const host = process.env.PGHOST;
  if (!host) return undefined;
  const user = encodeURIComponent(process.env.PGUSER || '');
  const pass = encodeURIComponent(process.env.PGPASSWORD || '');
  const port = process.env.PGPORT || '5432';
  const db   = process.env.PGDATABASE || 'postgres';
  // sslmode=require works for NF & most hosted PG (ignore self-signed)
  return `postgresql://${user}:${pass}@${host}:${port}/${db}?sslmode=require`;
}

const connectionString =
  process.env.DATABASE_URL || buildUrlFromNFEnv();

if (!connectionString) {
  throw new Error('DATABASE_URL not set (or NF PG env vars missing).');
}

export const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

export async function q<T = any>(text: string, params?: any[]) {
  return pool.query<T>(text, params);
}

export async function dbHealth() {
  await pool.query('select 1');
  return true;
}