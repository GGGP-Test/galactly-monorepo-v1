// src/routes/events.ts
//
// Zero-deps event collector + viewer (in-memory).
// Endpoints (mounted under /api/events in index.ts):
//   GET  /api/events/ping          -> { pong:true }
//   GET  /api/events               -> tiny summary
//   GET  /api/events/recent?limit=100
//   GET  /api/events/stats         -> totals + last24h breakdown
//   POST /api/events/ingest        -> accepts 1 event or an array of events
//
// Notes
// - In-memory only (per pod). Safe to run on free infra.
// - No external libs; strict, defensive parsing.
// - Designed to power a simple admin dashboard (next files).

import { Router, Request, Response } from "express";

const r = Router();

/* -------------------------------------------------------------------------- */
/* Types & guards                                                              */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>;

export type EventItem = {
  id: string;              // monotonic-ish id
  ts: number;              // epoch millis
  type: string;            // "page_view" | "click" | "error" | ...
  user?: string;           // free-form user id/email
  path?: string;           // page or route
  ip?: string;             // best-effort client hint
  ua?: string;             // user-agent
  meta?: Json;             // small bag of extra data
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
  // prune deeply by 1 level, keep only primitives and short strings
  const out: Json = {};
  let count = 0;
  for (const [k, val] of Object.entries(v)) {
    if (!k || count >= 40) break;
    const t = typeof val;
    if (t === "string" || t === "number" || t === "boolean") {
      const vv = t === "string" ? (val as string).slice(0, 500) : val;
      out[k] = vv as unknown;
      count++;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
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
  return ev;
}

function lastN(n: number): EventItem[] {
  const m = Math.max(1, Math.min(n, MAX_EVENTS));
  return store.slice(-m).reverse();
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
      .reduce<Record<string, number>>((acc, [k, v]) => {
        acc[k] = v;
        return acc;
      }, {});

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
/* Routes                                                                      */
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
      const ev = addEvent({
        type,
        user,
        path,
        ip,
        ua,
        meta: asMeta((raw as any).meta),
        ts: Number.isFinite(tsNum) ? tsNum : undefined,
      });
      return ev;
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

export default r;