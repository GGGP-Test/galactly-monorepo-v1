// src/shared/quota-store.ts
//
// Per-user daily quota store with Neon/Postgres first, in-memory fallback.
// No hard deps required: we safe-require "pg". If missing or DB down, we
// degrade to a process-local Map (good enough for Free tier + dev).
//
// Usage pattern (from a route):
//   import { quota } from "../shared/quota-store";
//   const plan = req.headers["x-user-plan"] === "vip" ? "vip"
//              : req.headers["x-user-plan"] === "pro" ? "pro" : "free";
//   const email = String(req.headers["x-user-email"] || "").trim().toLowerCase();
//   const limit = plan === "vip" ? 100 : plan === "pro" ? 25 : 3; // pass from plan engine
//   const q = await quota.bump(email || "anon:"+ip, plan, 1, { limit });
//   if (!q.allowed) return res.status(200).json({ ok:false, error:"quota", remaining:q.remaining });
//
// Schema (Postgres):
//   CREATE TABLE IF NOT EXISTS usage_quota (
//     email        text NOT NULL,
//     window_start date NOT NULL,
//     plan         text NOT NULL,
//     used         integer NOT NULL DEFAULT 0,
//     updated_at   timestamptz NOT NULL DEFAULT now(),
//     PRIMARY KEY (email, window_start)
//   );

import { CFG } from "./env";

type PlanCode = "free" | "pro" | "vip";

export type QuotaCheck = {
  email: string;
  plan: PlanCode;
  windowStart: string;   // YYYY-MM-DD (UTC)
  used: number;
  limit: number;
  remaining: number;
  allowed: boolean;
  backend: "pg" | "memory";
};

type BumpOpts = { limit: number; windowDays?: number };

function utcDateOnly(ms = Date.now()): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// -------- optional Postgres wiring (safe) -----------------------------------
type PGLike = {
  Pool: new (cfg: any) => {
    query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
    end: () => Promise<void>;
  };
};
let PG: PGLike | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PG = require("pg");
} catch {
  PG = null;
}

// Lazy singleton pool
let pool: InstanceType<PGLike["Pool"]> | null = null;
function getPool() {
  if (!PG || !process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new PG.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX || 5),
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS usage_quota (
  email        text NOT NULL,
  window_start date NOT NULL,
  plan         text NOT NULL,
  used         integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, window_start)
);
`;

async function ensureSchema(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  try { await p.query(INIT_SQL); return true; } catch { return false; }
}

// -------- memory fallback ----------------------------------------------------
type Key = string; // email|windowStart
const MEM = new Map<Key, { used: number; plan: PlanCode }>();

function keyOf(email: string, day: string): Key {
  return `${email}|${day}`;
}

// -------- public API ---------------------------------------------------------
async function pgBump(
  email: string,
  plan: PlanCode,
  inc: number,
  limit: number,
  windowStart: string
): Promise<QuotaCheck | null> {
  const p = getPool();
  if (!p) return null;
  await ensureSchema();
  // Upsert, then select
  const upsert = `
INSERT INTO usage_quota (email, window_start, plan, used)
VALUES ($1, $2, $3, GREATEST($4,0))
ON CONFLICT (email, window_start)
DO UPDATE SET used = usage_quota.used + GREATEST($4,0), plan = EXCLUDED.plan, updated_at = now();
`;
  const sel = `SELECT used FROM usage_quota WHERE email=$1 AND window_start=$2 LIMIT 1`;

  await p.query(upsert, [email, windowStart, plan, clamp(inc, 0, 1000000)]);
  const got = await p.query(sel, [email, windowStart]);
  const used = Number(got.rows?.[0]?.used || 0);
  const remaining = Math.max(0, limit - used);
  return { email, plan, windowStart, used, limit, remaining, allowed: used <= limit - 1, backend: "pg" };
}

function memBump(
  email: string,
  plan: PlanCode,
  inc: number,
  limit: number,
  windowStart: string
): QuotaCheck {
  const k = keyOf(email, windowStart);
  const cur = MEM.get(k) || { used: 0, plan };
  cur.plan = plan;
  cur.used = clamp(cur.used + clamp(inc, 0, 1000000), 0, 10_000_000);
  MEM.set(k, cur);
  const used = cur.used;
  const remaining = Math.max(0, limit - used);
  return { email, plan, windowStart, used, limit, remaining, allowed: used <= limit - 1, backend: "memory" };
}

/**
 * Increment usage and return the current window usage.
 * - `limit` must be provided by the plan engine (so we are NOT env-driven).
 * - `windowDays` is currently informational; we roll windows by UTC date (1 day).
 */
export async function bump(
  emailRaw: string,
  plan: PlanCode,
  inc = 1,
  opts: BumpOpts
): Promise<QuotaCheck> {
  const email = String(emailRaw || "").trim().toLowerCase() || "anonymous";
  const limit = Math.max(0, Number(opts?.limit ?? 0));
  const windowStart = utcDateOnly(); // day windows (QUOTA_WINDOW_DAYS handled upstream for multi-day logic)

  // Try Postgres, otherwise fallback
  const pg = await pgBump(email, plan, inc, limit, windowStart);
  if (pg) return pg;
  return memBump(email, plan, inc, limit, windowStart);
}

/** Read-only check (no increment). */
export async function peek(
  emailRaw: string,
  plan: PlanCode,
  opts: { limit: number }
): Promise<QuotaCheck> {
  const email = String(emailRaw || "").trim().toLowerCase() || "anonymous";
  const limit = Math.max(0, Number(opts?.limit ?? 0));
  const windowStart = utcDateOnly();

  const p = getPool();
  if (p && (await ensureSchema())) {
    try {
      const sel = `SELECT used FROM usage_quota WHERE email=$1 AND window_start=$2 LIMIT 1`;
      const got = await p.query(sel, [email, windowStart]);
      const used = Number(got.rows?.[0]?.used || 0);
      const remaining = Math.max(0, limit - used);
      return { email, plan, windowStart, used, limit, remaining, allowed: used < limit, backend: "pg" };
    } catch { /* fall through */ }
  }
  // memory
  const k = keyOf(email, windowStart);
  const used = Number(MEM.get(k)?.used || 0);
  const remaining = Math.max(0, limit - used);
  return { email, plan, windowStart, used, limit, remaining, allowed: used < limit, backend: "memory" };
}

/** Admin/reset helper for tests or plan downgrades. */
export async function reset(emailRaw: string): Promise<void> {
  const email = String(emailRaw || "").trim().toLowerCase() || "anonymous";
  const day = utcDateOnly();
  const p = getPool();
  if (p && (await ensureSchema())) {
    try { await p.query(`DELETE FROM usage_quota WHERE email=$1 AND window_start=$2`, [email, day]); } catch {}
  }
  MEM.delete(keyOf(email, day));
}

export const quota = { bump, peek, reset };
export default quota;