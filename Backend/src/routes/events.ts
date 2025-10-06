// src/routes/events.ts
//
// Zero-deps event collector + viewer (in-memory) + SSE live stream.
// Endpoints (mounted under /api/events in index.ts):
//   GET  /api/events/ping                -> { pong:true }
//   GET  /api/events                     -> tiny summary
//   GET  /api/events/recent?limit=100    -> last N (most-recent-first)
//   GET  /api/events/stats               -> totals + last24h breakdown
//   POST /api/events/ingest              -> accepts 1 event or an array
//   GET  /api/events/stream[?since=ms]   -> Server-Sent Events live stream
//
// Notes
// - In-memory only (per pod). Deterministic, no external libs.
// - SSE clients receive a tiny backlog (last 20) on connect, then live events.

import { Router, Request, Response } from "express";

const r = Router();

/* -------------------------------------------------------------------------- */
/* Types & guards                                                             */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>;

export type EventItem = {
  id: string;              // monotonic-ish id
  ts: number;              // epoch millis
  type: string;            // "page_view" | "click" | "error" | ...
  user?: string;
  path?: string;
  ip?: string;
  ua?: string;
  meta?: Json;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function asStr(v: unknown): string | undefined {
  const s = (v == null ? "" : String(v)).trim();
  return s ? s : undefined;
}
function asMeta(v: unknown): Json | undefined {
  if (!isObj(v)) return undefined;
  // prune shallow (only keep primitives + short strings)
  const out: Json = {};
  let count = 0;
  for (const [k, val] of Object.entries(v)) {
    if (!k || count >= 40) break;
    const t = typeof val;
    if (t === "string" || t === "number" || t === "boolean") {
      out[k] = t === "string" ? (val as string).slice(0, 500) : val;
      count++;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

const MAX_EVENTS = 5000;
const store: EventItem[] = [];
const countsByTypeTotal = new Map<string, number>();
let SEQ = 0;

function nextId(): string {
  SEQ = (SEQ + 1) >>> 0;
  return `${Date.now()}-${SEQ}`;
}

function addEvent(e: Omit<EventItem, "id" | "ts"> & { ts?: number }): EventItem {
  const ev: EventItem = {
    id: nextId(),
    ts: Number.isFinite(e.ts) ? (e.ts as number) : Date.now(),
    type: e.type || "event",
    user: e.user,
    path: e.path,
    ip: e.ip,
    ua: e.ua,
    meta: e.meta,
  };
  store.push(ev);
  if (store.length > MAX_EVENTS) store.shift();
  countsByTypeTotal.set(ev.type, (countsByTypeTotal.get(ev.type) || 0) + 1);
  // push to SSE clients
  broadcast(ev);
  return ev;
}

function lastN(n: number): EventItem[] {
  const m = Math.max(1, Math.min(n, MAX_EVENTS));
  return store.slice(-m).reverse();
}

function sinceTs(ts: number, cap = 200): EventItem[] {
  if (!Number.isFinite(ts) || ts <= 0) return [];
  const out: EventItem[] = [];
  for (let i = store.length - 1; i >= 0 && out.length < cap; i--) {
    const ev = store[i];
    if (ev.ts <= ts) break;
    out.push(ev);
  }
  return out.reverse();
}

function statsNow() {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const byType24 = new Map<string, number>();
  const topPaths = new Map<string, number>();

  for (let i = store.length - 1; i >= 0; i--) {
    const ev = store[i];
    if (ev.ts < dayAgo) break; // store is time-ordered
    byType24.set(ev.type, (byType24.get(ev.type) || 0) + 1);
    const p = ev.path || "";
    if (p) topPaths.set(p, (topPaths.get(p) || 0) + 1);
  }

  const toObj = (m: Map<string, number>) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .reduce<Record<string, number>>((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  return {
    total: store.length,
    byTypeTotal: toObj(countsByTypeTotal),
    byType24h: toObj(byType24),
    topPaths24h: Array.from(topPaths.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([path, count]) => ({ path, count })),
    sinceIso: new Date(dayAgo).toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* SSE (Server-Sent Events)                                                   */
/* -------------------------------------------------------------------------- */

type Client = { id: string; res: Response; pingTimer: any };
const clients = new Map<string, Client>();

function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // If compression middleware is present, this helps:
  (res as any).flushHeaders?.();
}

function sseWrite(res: Response, event: string, data: unknown) {
  const line = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  res.write(line);
}

function broadcast(ev: EventItem) {
  if (clients.size === 0) return;
  for (const [id, c] of clients) {
    try {
      sseWrite(c.res, "event", ev);
    } catch {
      try { c.res.end(); } catch {}
      clearInterval(c.pingTimer);
      clients.delete(id);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, now: new Date().toISOString() });
});

r.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, total: store.length });
});

r.get("/recent", (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  res.json({ ok: true, items: lastN(limit) });
});

r.get("/stats", (_req: Request, res: Response) => {
  res.json({ ok: true, ...statsNow() });
});

r.post("/ingest", (req: Request, res: Response) => {
  try {
    const body = req.body;
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (req.ip || req.socket.remoteAddress || "").toString();
    const ua = (req.headers["user-agent"] as string) || "";

    const normalizeOne = (raw: unknown): EventItem | null => {
      if (!isObj(raw)) return null;
      const type = asStr(raw.type) || "event";
      const user = asStr(raw.user);
      const path = asStr((raw as any).path || (raw as any).url || (raw as any).route);
      const tsNum = Number((raw as any).ts);
      return addEvent({
        type, user, path, ip, ua,
        meta: asMeta((raw as any).meta),
        ts: Number.isFinite(tsNum) ? tsNum : undefined,
      });
    };

    const added: EventItem[] = [];
    if (Array.isArray(body)) {
      for (const item of body) {
        const ev = normalizeOne(item);
        if (ev) added.push(ev);
      }
    } else {
      const ev = normalizeOne(body);
      if (ev) added.push(ev);
    }

    return res.json({ ok: true, added: added.length });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "ingest-failed", detail: msg });
  }
});

/** Live stream via Server-Sent Events. Optional ?since=epoch_ms to replay recent items. */
r.get("/stream", (req: Request, res: Response) => {
  try {
    sseHeaders(res);
    const id = nextId();
    const client: Client = { id, res, pingTimer: null as any };
    clients.set(id, client);

    // Initial comment + tiny backlog (or since=)
    res.write(`: connected ${new Date().toISOString()}\n\n`);
    const since = Number(req.query.since || 0);
    const backlog = Number.isFinite(since) && since > 0 ? sinceTs(since, 200) : lastN(20).reverse().reverse();
    for (const ev of backlog) sseWrite(res, "event", ev);

    // Keepalive ping every 25s
    client.pingTimer = setInterval(() => {
      try { sseWrite(res, "ping", { t: Date.now() }); } catch { /* cleanup below on close */ }
    }, 25000);

    // Cleanup on disconnect
    req.on("close", () => {
      clearInterval(client.pingTimer);
      clients.delete(id);
      try { res.end(); } catch {}
    });
  } catch {
    try { res.end(); } catch {}
  }
});

export default r;