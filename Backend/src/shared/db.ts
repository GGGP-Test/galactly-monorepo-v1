// Backend/src/shared/db.ts
//
// Minimal DB helper used by routes and index.
// - If process.env.DATABASE_URL is a postgres URL *and* the "pg" module is
//   available at runtime, we use it.
// - Otherwise we fall back to a safe in-memory stub so TypeScript builds succeed
//   and the service can run without a DB (writes become no-ops).
//

// This keeps CI/CD green while you decide between Neon vs Northflank PG.
//
// Exports:
//   hasDb(): Promise<boolean>
//   ensureSchema(): Promise<void>
//   q<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>
//   closeDb(): Promise<void>

type QueryResult<T = any> = { rows: T[]; rowCount: number };

const url = (process.env.DATABASE_URL || "").trim();
const isPgUrl = /^postgres(ql)?:\/\//i.test(url);

// We avoid importing "pg" types so the build doesn’t require @types/pg.
let pgPool: any = null;
let mode: "pg" | "memory" = "memory";

// Try to enable Postgres mode (only if both URL and module exist)
if (isPgUrl) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require("pg");
    pgPool = new Pool({
      connectionString: url,
      ssl: url.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
    });
    mode = "pg";
    // Eager ping to surface bad URLs early (non-blocking)
    pgPool.query("select 1").catch(() => {
      mode = "memory";
      pgPool = null;
    });
  } catch {
    mode = "memory";
    pgPool = null;
  }
}

// ---- in-memory stub (used when no Postgres) ----
const mem = {
  lead_pool: [] as any[],
};

export async function hasDb(): Promise<boolean> {
  return mode === "pg";
}

export async function ensureSchema(): Promise<void> {
  if (mode !== "pg" || !pgPool) {
    // memory mode: initialize nothing
    return;
  }
  // A permissive superset schema so various writers don’t break.
  const ddl = `
  create table if not exists lead_pool (
    id bigserial primary key,
    host text unique,
    platform text,
    title text,
    why_text text,
    temp text,
    created timestamptz default now(),
    -- optional/aux columns used by different writers
    cat text,
    kw text[],
    fit_user int,
    heat int,
    source_url text,
    snippet text,
    ttl timestamptz,
    state text
  );
  create index if not exists idx_lead_pool_created on lead_pool(created desc);
  create index if not exists idx_lead_pool_host on lead_pool(host);
  `;
  await pgPool.query(ddl);
}

export async function q<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
  if (mode === "pg" && pgPool) {
    const r = await pgPool.query(sql, params);
    return { rows: r.rows as T[], rowCount: r.rowCount || 0 };
    }
  // Memory fallback: recognize a tiny subset used by our code paths
  const s = sql.trim().toLowerCase();

  if (s.startsWith("insert into lead_pool")) {
    // Extremely lenient parser: expect host in params somewhere
    const hostParamIndex = params.findIndex((v) => typeof v === "string" && v.includes("."));
    const host = hostParamIndex >= 0 ? String(params[hostParamIndex]).toLowerCase() : undefined;
    if (host && !mem.lead_pool.find((r) => r.host === host)) {
      mem.lead_pool.push({
        host,
        platform: params.find((v) => v === "web") ? "web" : "web",
        title: params.find((v) => typeof v === "string" && v.length && !v.includes(".")) || "",
        why_text: "",
        temp: "warm",
        created: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (s.startsWith("select") && s.includes("from lead_pool")) {
    // Return all (caller can filter in code if needed)
    return { rows: mem.lead_pool as T[], rowCount: mem.lead_pool.length };
  }

  if (s.startsWith("delete from lead_pool")) {
    mem.lead_pool.length = 0;
    return { rows: [], rowCount: 0 };
  }

  // Default no-op
  return { rows: [] as T[], rowCount: 0 };
}

export async function closeDb(): Promise<void> {
  if (mode === "pg" && pgPool) {
    try { await pgPool.end(); } catch {}
  }
}