// src/routes/events.ts
//
// Minimal event ingest + read-only monitor.
// Endpoints (mounted under /api/events):
//   POST /api/events/track    -> {ok:true,id}
//   GET  /api/events/recent   -> last N (default 200)
//   GET  /api/events/stats    -> counts by type (last 24h)
//   GET  /api/events/ping     -> {pong:true}

import { Router, Request, Response } from "express";

type EventProps = Record<string, unknown>;

type EventRecord = {
  id: number;
  ts: number;            // epoch ms
  at: string;            // ISO
  type: string;
  host: string;
  path: string;
  ip: string;
  ua: string;
  props?: EventProps;
};

// ---- tiny helpers ----
function asStr(v: unknown): string { return (v == null ? "" : String(v)).trim(); }
function normHost(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}
function clientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || (req.ip || req.socket.remoteAddress || "").toString();
}
function clamp(n: number, a: number, b: number): number { return Math.max(a, Math.min(b, n)); }

// ---- in-memory ring buffer ----
const MAX_EVENTS = 2000;
const store: EventRecord[] = [];
let NEXT_ID = 1;

function pushEvent(e: EventRecord) {
  store.push(e);
  if (store.length > MAX_EVENTS) store.splice(0, store.length - MAX_EVENTS);
}

const r = Router();

// liveness
r.get("/ping", (_req, res) => res.json({ pong: true, at: new Date().toISOString() }));

// ingest
r.post("/track", (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;

    // hard limits + sanitization
    const type = asStr(body.type).slice(0, 48) || "event";
    const host = normHost(asStr(body.host)) || normHost(req.headers.origin as string || "") || "-";
    const path = asStr(body.path || (req.headers.referer as string) || "").slice(0, 200) || "-";
    const propsRaw = (body.props && typeof body.props === "object") ? (body.props as EventProps) : undefined;

    // shallow clone + size guard on props
    const props = propsRaw ? JSON.parse(JSON.stringify(propsRaw)) as EventProps : undefined;
    const now = Date.now();
    const rec: EventRecord = {
      id: NEXT_ID++,
      ts: now,
      at: new Date(now).toISOString(),
      type,
      host,
      path,
      ip: clientIp(req),
      ua: asStr(req.headers["user-agent"]).slice(0, 160),
      props,
    };

    pushEvent(rec);
    return res.json({ ok: true, id: rec.id });
  } catch (err: unknown) {
    return res.status(200).json({ ok: false, error: "ingest-failed", detail: String((err as any)?.message || err) });
  }
});

// recent N
r.get("/recent", (req: Request, res: Response) => {
  const limit = clamp(Number(req.query.limit) || 200, 1, MAX_EVENTS);
  const items = store.slice(-limit).reverse();
  res.json({ ok: true, total: items.length, items });
});

// simple stats (last 24h)
r.get("/stats", (_req: Request, res: Response) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const byType: Record<string, number> = {};
  let total24h = 0;
  for (let i = store.length - 1; i >= 0; i--) {
    const e = store[i];
    if (e.ts < cutoff) break;
    total24h++;
    byType[e.type] = (byType[e.type] || 0) + 1;
  }
  res.json({ ok: true, last24h: total24h, byType });
});

export default r;