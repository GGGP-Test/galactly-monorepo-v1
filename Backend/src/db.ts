// Backend/src/db.ts
import { Pool } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL || process.env.NF_DATABASE_URL || '';

if (!DATABASE_URL) {
  // Safe default so the API still boots for non-DB endpoints
  console.warn('DATABASE_URL is not set – DB calls will fail.');
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 4,
  ssl: /neon\.tech|render\.com|herokuapp\.com/i.test(DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function q<T = any>(sql: string, params?: any[]) {
  const res = await pool.query(sql, params);
  return res as { rows: T[]; rowCount: number };
}

export async function dbHealth() {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}