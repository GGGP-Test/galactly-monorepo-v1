// Backend/src/shared/db.ts
import { Pool } from "pg";

const {
  DATABASE_URL,
  PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT, PGSSL
} = process.env;

// Build a connection string if Northflank injects discrete vars
let conn = DATABASE_URL;
if (!conn && PGHOST && PGUSER && PGPASSWORD) {
  const host = PGHOST;
  const db   = PGDATABASE || "postgres";
  const port = Number(PGPORT || "5432");
  conn = `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${host}:${port}/${db}`;
}

// Fail fast with a clear message
if (!conn) {
  throw new Error("DATABASE_URL (or PG* vars) are required for postgres.");
}

// Northflank uses TLS; allow sslmode=require strings too
const sslNeeded =
  /sslmode=require/i.test(conn) || (PGSSL || "").toLowerCase() === "require";

export const pool = new Pool({
  connectionString: conn,
  ssl: sslNeeded ? { rejectUnauthorized: false } : undefined,
});

export async function q<T = any>(text: string, params?: any[]) {
  const res = await pool.query(text, params);
  return { rows: res.rows as T[], rowCount: (res as any).rowCount ?? res.rows.length };
}

export async function ensureSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS lead_pool (
      id          BIGSERIAL PRIMARY KEY,
      host        TEXT NOT NULL,
      platform    TEXT NOT NULL DEFAULT 'web',
      title       TEXT,
      why         TEXT,
      temp        TEXT NOT NULL DEFAULT 'warm',
      created     TIMESTAMPTZ NOT NULL DEFAULT now(),
      source_url  TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS lead_pool_host_created_idx
      ON lead_pool(host, created DESC);
  `);
}