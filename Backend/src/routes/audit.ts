// src/routes/audit.ts
//
// Admin-style audit endpoints built on top of /api/events.
// No shared state: we fetch from our own HTTP endpoints so this
// works even if events storage changes implementation later.
//
// Mount at /api/audit in index.ts (one import + one app.use).

import { Router, Request, Response } from "express";
import { CFG } from "../shared/env";

const r = Router();

// Use Node 18+/20+ global fetch, but keep types loose to avoid DOM libs.
const F: (u: string, init?: any) => Promise<any> = (globalThis as any).fetch;

// ---- tiny helpers ----
function atoi(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function asStr(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}
function toMs(v?: string): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n; // epoch
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

type Ev = {
  id: string;
  ts: number;
  type: string;
  user?: string;
  path?: string;
  ip?: string;
  ua?: string;
  meta?: Record<string, unknown>;
};

function csvEscape(s: string): string {
  // escape " by doubling; wrap with quotes if any comma/quote/newline
  const needs = /[",\n]/.test(s);
  const body = s.replace(/"/g, '""');
  return needs ? `"${body}"` : body;
}

function makeCsv(rows: Ev[]): string {
  const header = ["id","ts","iso","type","user","path","ip","ua","meta"].join(",");
  const lines = rows.map(r => {
    const iso = new Date(r.ts).toISOString();
    const meta = r.meta ? JSON.stringify(r.meta).slice(0, 2000) : "";
    return [
      r.id, String(r.ts), iso, r.type,
      r.user ?? "", r.path ?? "", r.ip ?? "", r.ua ?? "", meta
    ].map(csvEscape).join(",");
  });
  return [header, ...lines].join("\n");
}

async function fetchRecent(limit: number): Promise<Ev[]> {
  const base = `http://127.0.0.1:${Number(CFG.port || process.env.PORT || 8787)}`;
  const url = `${base}/api/events/recent?limit=${encodeURIComponent(String(limit))}`;
  const res = await F(url, { redirect: "follow" });
  if (!res?.ok) return [];
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return items as Ev[];
}

// ---- routes ----

// sanity
r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, now: new Date().toISOString() });
});

// stats over last N minutes (default 60)
r.get("/window", async (req: Request, res: Response) => {
  try {
    const minutes = Math.max(1, Math.min(24 * 60, atoi(req.query.minutes, 60)));
    const limit = Math.max(50, Math.min(5000, atoi(req.query.limit, 2000)));
    const since = Date.now() - minutes * 60 * 1000;

    const items = (await fetchRecent(limit)).filter(e => e.ts >= since);

    const byType: Record<string, number> = {};
    const byPath: Record<string, number> = {};
    for (const e of items) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.path) byPath[e.path] = (byPath[e.path] || 0) + 1;
    }
    const topPaths = Object.entries(byPath)
      .sort((a,b)=>b[1]-a[1]).slice(0,25)
      .map(([path,count])=>({path,count}));

    res.json({
      ok: true,
      windowMin: minutes,
      total: items.length,
      byType,
      topPaths,
      sinceIso: new Date(since).toISOString(),
      now: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(200).json({ ok:false, error:"audit-window-failed", detail:String(err?.message||err) });
  }
});

// CSV export with filters
// GET /api/audit/export.csv?limit=2000&since=ISO_or_ms&until=ISO_or_ms&type=page_view&user=abc&path=onboarding
r.get("/export.csv", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(50, Math.min(5000, atoi(req.query.limit, 2000)));
    const type = asStr(req.query.type);
    const user = asStr(req.query.user);
    const pathSub = asStr(req.query.path).toLowerCase();
    const sinceMs = toMs(asStr(req.query.since));
    const untilMs = toMs(asStr(req.query.until));

    let rows = await fetchRecent(limit);

    if (sinceMs != null) rows = rows.filter(e => e.ts >= sinceMs);
    if (untilMs != null) rows = rows.filter(e => e.ts <= untilMs);
    if (type) rows = rows.filter(e => e.type === type);
    if (user) rows = rows.filter(e => (e.user || "") === user);
    if (pathSub) rows = rows.filter(e => (e.path || "").toLowerCase().includes(pathSub));

    const csv = makeCsv(rows);
    const fname = `events-${new Date().toISOString().replace(/[:.]/g,"-")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (err: any) {
    res.status(200).json({ ok:false, error:"audit-export-failed", detail:String(err?.message||err) });
  }
});

// Simple passthrough to /api/events/stats
r.get("/stats", async (_req: Request, res: Response) => {
  try {
    const base = `http://127.0.0.1:${Number(CFG.port || process.env.PORT || 8787)}`;
    const url = `${base}/api/events/stats`;
    const resp = await F(url);
    const data = await resp.json();
    res.json(data);
  } catch (err: any) {
    res.status(200).json({ ok:false, error:"audit-stats-failed", detail:String(err?.message||err) });
  }
});

export default r;