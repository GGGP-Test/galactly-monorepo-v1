// src/routes/claim-admin.ts
//
// Admin endpoints to review & manage Claim/Hide.
// Mount as:  app.use("/api/claim-admin", ClaimAdminRouter)
//
// Auth: require header x-admin-key (or x-admin-token) == ADMIN_API_KEY (or ADMIN_TOKEN)

import { Router, Request, Response } from "express";

type Row = {
  host: string;
  owner: string | null;
  owned_at: string | null;   // ISO
  hidden_by: string | null;
  hidden_at: string | null;  // ISO
};

const r = Router();

function isAdmin(req: Request): boolean {
  const got = (req.header("x-admin-key") || req.header("x-admin-token") || "").trim();
  const need = (process.env.ADMIN_API_KEY || process.env.ADMIN_TOKEN || "").trim();
  return !!need && got === need;
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!isAdmin(req)) {
    res.status(401).json({ ok: false, error: "admin" });
    return false;
  }
  return true;
}

async function withPg<T>(fn: (client: any) => Promise<T>): Promise<T | null> {
  const url = (process.env.DATABASE_URL || "").trim();
  let pg: any = null;
  try { pg = require("pg"); } catch { return null; }
  if (!url) return null;

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try { return await fn(client); }
  finally { try { await client.end(); } catch {} }
}

async function ensureTable(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS claims(
      host TEXT PRIMARY KEY,
      owner TEXT,
      owned_at TIMESTAMPTZ,
      hidden_by TEXT,
      hidden_at TIMESTAMPTZ
    );
  `);
}

/* ------------------------------- routes -------------------------------- */

r.get("/_ping", (_req, res) => {
  res.json({ ok: true, route: "claim-admin", now: new Date().toISOString() });
});

// GET /api/claim-admin/list?limit=100&offset=0&owner=&host=
r.get("/list", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const owner = String(req.query.owner || "").trim().toLowerCase();
  const hostSub = String(req.query.host || "").trim().toLowerCase();

  const out = await withPg(async (db) => {
    await ensureTable(db);

    const where: string[] = [];
    const params: any[] = [];
    if (owner) { params.push(owner); where.push(`LOWER(owner) = $${params.length}`); }
    if (hostSub) { params.push(`%${hostSub}%`); where.push(`LOWER(host) LIKE $${params.length}`); }

    const sql = `
      SELECT host, owner,
             CASE WHEN owned_at  IS NULL THEN NULL ELSE to_char(owned_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END as owned_at,
             hidden_by,
             CASE WHEN hidden_at IS NULL THEN NULL ELSE to_char(hidden_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END as hidden_at
      FROM claims
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(owned_at, hidden_at) DESC NULLS LAST, host ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = (await db.query(sql, params)).rows as Row[];

    const countSql = `
      SELECT COUNT(*)::int AS n
      FROM claims
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `;
    const total = Number((await db.query(countSql, params)).rows?.[0]?.n || 0);

    return { rows, total };
  });

  if (!out) {
    // No DB available — return empty list but keep 200 to avoid breaking tools.
    return res.json({
      ok: true,
      total: 0,
      items: [] as Row[],
      note: "No DATABASE_URL/pg; returning empty list."
    });
  }

  res.json({ ok: true, total: out.total, items: out.rows });
});

// GET /api/claim-admin/export.csv  (same filters as /list)
r.get("/export.csv", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const owner = String(req.query.owner || "").trim().toLowerCase();
  const hostSub = String(req.query.host || "").trim().toLowerCase();

  const data = await withPg(async (db) => {
    await ensureTable(db);
    const where: string[] = [];
    const params: any[] = [];
    if (owner) { params.push(owner); where.push(`LOWER(owner) = $${params.length}`); }
    if (hostSub) { params.push(`%${hostSub}%`); where.push(`LOWER(host) LIKE $${params.length}`); }

    const sql = `
      SELECT host, owner,
             to_char(owned_at  AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS owned_at,
             hidden_by,
             to_char(hidden_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hidden_at
      FROM claims
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(owned_at, hidden_at) DESC NULLS LAST, host ASC
    `;
    const rows = (await db.query(sql, params)).rows as Row[];
    return rows;
  });

  const rows = data || [];
  const csvLines = [
    "host,owner,owned_at,hidden_by,hidden_at",
    ...rows.map(r => [
      r.host || "",
      r.owner || "",
      r.owned_at || "",
      r.hidden_by || "",
      r.hidden_at || ""
    ].map(s => /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s).join(","))
  ];
  const csv = csvLines.join("\n");
  const fname = `claims-${new Date().toISOString().replace(/[:.]/g,"-")}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(csv);
});

// POST /api/claim-admin/unhide { host }
r.post("/unhide", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const host = String(req.body?.host || "").trim().toLowerCase();
  if (!host) return res.status(400).json({ ok: false, error: "host" });

  const ok = await withPg(async (db) => {
    await ensureTable(db);
    await db.query(`UPDATE claims SET hidden_by=NULL, hidden_at=NULL WHERE host=$1`, [host]);
    return true;
  });

  if (!ok) return res.status(200).json({ ok: false, error: "no-db" });
  res.json({ ok: true, host, hiddenBy: null, hiddenAt: null });
});

// POST /api/claim-admin/clear { host }  (hard delete)
r.post("/clear", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const host = String(req.body?.host || "").trim().toLowerCase();
  if (!host) return res.status(400).json({ ok: false, error: "host" });

  const ok = await withPg(async (db) => {
    await ensureTable(db);
    await db.query(`DELETE FROM claims WHERE host=$1`, [host]);
    return true;
  });

  if (!ok) return res.status(200).json({ ok: false, error: "no-db" });
  res.json({ ok: true, host, deleted: true });
});

export default r;