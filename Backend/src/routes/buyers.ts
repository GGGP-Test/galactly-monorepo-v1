// src/routes/buyers.ts
//
// Public buyers API used by the free panel.
// - GET /api/buyers/find     -> proxy to /api/leads/find-buyers
// - GET /api/buyers/search   -> same as /find (compat)
// - GET /api/find            -> alias that calls the same handler (mounted in index.ts)
//
// Notes
// • We DO NOT touch private router internals (e.g., .handle). Instead we
//   compose a tiny alias router and bind the same handler for "/".
// • We translate the panel’s `count` query param to the leads route’s `limit`.

import { Router, Request, Response } from "express";
import { CFG } from "../shared/env";

const r = Router();

// ---------- helpers ----------
function s(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}
function normHost(input: unknown): string {
  return s(input).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

async function proxyFind(hostRaw: string, q: URLSearchParams): Promise<any> {
  const host = normHost(hostRaw);
  const limit = s(q.get("count")) || s(q.get("limit")) || "";
  const city = s(q.get("city"));
  const sectors = s(q.get("sectors")); // comma-separated
  const tags = s(q.get("tags"));       // comma-separated

  if (!host) {
    return { ok: false, error: "host_required" };
  }

  const out = new URL(`http://127.0.0.1:${Number(CFG.port) || 8787}/api/leads/find-buyers`);
  if (host) out.searchParams.set("host", host);
  if (limit) out.searchParams.set("limit", limit);
  if (city) out.searchParams.set("city", city);
  if (sectors) out.searchParams.set("sectors", sectors);
  if (tags) out.searchParams.set("tags", tags);

  const res = await fetch(out.toString(), { redirect: "follow" });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: "bad_json", detail: text.slice(0, 200) }; }
}

// single handler reused by all entry points
async function findHandler(req: Request, res: Response) {
  try {
    const q = new URLSearchParams(req.query as any);
    const data = await proxyFind(q.get("host") || "", q);
    // Always 200 with an ok flag for frontend simplicity
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "buyers-find-failed", detail: String(err?.message || err) });
  }
}

// routes under /api/buyers/*
r.get("/find", findHandler);
r.get("/search", findHandler);

// Optional ping for quick diagnostics (kept lightweight)
r.get("/ping", (_req, res) => res.json({ pong: true, at: new Date().toISOString() }));

export default r;

// ----- Root alias mounted at /api/find in index.ts -----
export const RootAlias = Router();
// support /api/find?host=... directly
RootAlias.get("/", findHandler);
// also expose the same subpaths under /api/find/*
RootAlias.use("/", r);
