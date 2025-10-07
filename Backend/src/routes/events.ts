// src/routes/events.ts
//
// Minimal, auth-aware in-memory events store.
// Endpoints (mounted at /api/events):
//   GET  /api/events/ping
//   POST /api/events/put        { kind, at?, data?, user? } | { events:[...] }
//   GET  /api/events/recent     ?limit=50
//   GET  /api/events/stats
//
// Auth header: x-admin-key must match one of
//   - process.env.ADMIN_TOKEN
//   - process.env.ADMIN_API_KEY
//   - process.env.ADMIN_KEY
//
// Notes: memory-only (per pod). Swap pushEvent() to Redis/DB later without
// changing callers.

import { Router, type Request, type Response, type NextFunction } from "express";

type Json = Record<string, unknown>;

export interface EventItem {
  kind: string;
  at: string;     // ISO time
  user?: string;
  data?: Json;
}

const r = Router();

// ---------- config ----------
const ADMIN_HEADER = "x-admin-key";
const ADMIN_KEYS = new Set<string>(
  [process.env.ADMIN_TOKEN, process.env.ADMIN_API_KEY, process.env.ADMIN_KEY]
    .map(v => (v || "").trim())
    .filter(Boolean)
);

// ---------- storage (ring buffer) ----------
const MAX_EVENTS = Number(process.env.EVENTS_MAX ?? 1000);
const events: EventItem[] = [];

function pushEvent(e: EventItem) {
  events.push(e);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

// ---------- auth ----------
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (ADMIN_KEYS.size === 0) return next(); // allow in dev if no keys configured
  const got = (req.header(ADMIN_HEADER) || "").trim();
  if (!got || !ADMIN_KEYS.has(got)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

// ---------- routes ----------
r.get("/ping", (_req, res) => res.json({ pong: true, at: new Date().toISOString() }));

// Write one or many events.
// Body: { kind, at?, data?, user? }  OR  { events: [ {kind, ...}, ... ] }
r.post("/put", requireAdmin, (req: Request, res: Response) => {
  try {
    const body: any = req.body || {};
    const now = new Date().toISOString();

    const addOne = (raw: any) => {
      const kind = String(raw?.kind || "").trim();
      if (!kind) return 0;
      const at = String(raw?.at || now);
      const user = typeof raw?.user === "string" ? raw.user : undefined;
      const data = raw?.data && typeof raw.data === "object" ? raw.data as Json : undefined;
      pushEvent({ kind, at, user, data });
      return 1;
    };

    let inserted = 0;
    if (Array.isArray(body?.events)) {
      for (const x of body.events) inserted += addOne(x);
    } else {
      inserted += addOne(body);
    }

    return res.json({ ok: true, inserted });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "put_failed", detail: String(err?.message || err) });
  }
});

r.get("/recent", requireAdmin, (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50)));
  const items = events.slice(Math.max(0, events.length - limit)).reverse();
  res.json({ ok: true, items });
});

r.get("/stats", requireAdmin, (_req: Request, res: Response) => {
  const byKind: Record<string, number> = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  res.json({
    ok: true,
    total: events.length,
    byKind,
    since: events[0]?.at ?? null,
    latest: events.at(-1)?.at ?? null,
  });
});

export default r;
