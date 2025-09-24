// File: src/shared/db.ts
// Single source of truth for database access.

import { Pool } from "pg";

/**
 * Choose one URL *once*:
 * - If you're keeping Neon: set env DATABASE_URL to the Neon connection string.
 * - If you're keeping Northflank PG addon: set env DATABASE_URL to the addon URI.
 *
 * Do NOT set both. The app only reads DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  // Don't crash at import time (lets tsc build), but make failures obvious at runtime.
  // eslint-disable-next-line no-console
  console.warn("[db] DATABASE_URL is not set. DB calls will fail until you set it.");
}

// Neon usually requires SSL; NF addon may not.
// This config works for both.
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    /neon\.tech|amazonaws\.com/i.test(DATABASE_URL)
      ? { rejectUnauthorized: false }
      : (undefined as any),
});

// -------- public helpers --------

/** Simple typed query helper. */
export async function q<R = any>(text: string, params?: any[]) {
  const res = await pool.query<R>(text, params);
  return res;
}

/** Quick connectivity check used by the app’s health/setup paths. */
export async function hasDb(): Promise<boolean> {
  try {
    await q("select 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates the minimal schema the app expects.
 * Idempotent: safe to call on every boot.
 */
export async function ensureSchema() {
  // One table for both warm/hot leads; "temp" column carries the bucket.
  await q(`
    create table if not exists leads (
      id          bigserial primary key,
      host        text        not null,
      platform    text        not null,
      title       text        not null,
      why_text    text        not null,
      temp        text        not null check (temp in ('warm','hot')),
      created_at  timestamptz not null default now()
    );
  `);

  // Keep dupes out but allow same host with different titles or temps.
  await q(`
    create unique index if not exists leads_host_title_temp
      on leads (host, title, temp);
  `);

  // Helpful indexes for typical queries.
  await q(`create index if not exists leads_created_at on leads (created_at desc);`);
  await q(`create index if not exists leads_host on leads (host);`);
}

/** Optional: graceful shutdown hook (use if you add a signal handler). */
export async function closeDb() {
  await pool.end();
}

// Useful types if you want them elsewhere.
export type LeadRow = {
  id: number;
  host: string;
  platform: string;
  title: string;
  why_text: string;
  temp: "warm" | "hot";
  created_at: string; // ISO
};