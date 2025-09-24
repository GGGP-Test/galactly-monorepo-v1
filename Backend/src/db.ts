// Backend/src/db.ts
/* Minimal, build-safe PG wrapper that works with Neon or Northflank.
   Uses dynamic require so your build doesn't fail if "pg" isn't installed yet.
*/

declare const require: any; // keep TS happy even if using ES modules

type Any = any;

// Try to load pg at runtime; provide a stub if it's missing so the build still passes.
let Pool: Any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Pool = require('pg').Pool;
} catch {
  Pool = class {
    constructor() {
      console.warn(
        '[db] "pg" not installed yet; DB calls will fail at runtime until it is.'
      );
    }
    async query() {
      throw new Error('pg driver not available');
    }
  };
}

// Prefer Neon first (you already have data), fall back to an NF add-on var if you switch later.
const DATABASE_URL =
  process.env.DATABASE_URL || process.env.NF_DATABASE_URL || '';

if (!DATABASE_URL) {
  console.warn('[db] DATABASE_URL not set – DB endpoints will return errors.');
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 4,
  ssl: /neon\.tech|render\.com|herokuapp\.com|northflank\.io/i.test(DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function q<T = Any>(sql: string, params?: Any[]) {
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