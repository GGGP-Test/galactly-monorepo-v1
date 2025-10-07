// src/routes/events.ts
// In-memory events with SSE stream for Admin Dashboard.
// Writes + reads need admin auth; SSE stream stays open (no custom headers).

import { Router, type Request, type Response, type NextFunction } from "express";

type Json = Record<string, unknown>;
export interface EventItem { kind: string; at: string; user?: string; data?: Json; }

const r = Router();

// ---- admin auth (accept multiple header names) ----
const ADMIN_KEYS = new Set(
  [process.env.ADMIN_TOKEN, process.env.ADMIN_API_KEY, process.env.ADMIN_KEY]
    .map(v => (v || "").trim())
    .filter(Boolean)
);

// read x-admin-key, x-admin-token, or Authorization: Bearer <key>
function getAdminFromHeaders(req: Request): string | undefined {
  const h1 = (req.header("x-admin-key") || "").trim();
  const h2 = (req.header("x-admin-token") || "").trim();
  const auth = (req.header("authorization") || "").trim();
  if (h1) return h1;
  if (h2) return h2;
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return undefined;
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (ADMIN_KEYS.size === 0) return next(); // allow in dev if no keys are set
  const got = getAdminFromHeaders(req);
  if (!got || !ADMIN_KEYS.has(got)) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      hint: "send x-admin-key or x-admin-token (or Authorization: Bearer …)",
    });
  }
  next();
}

// ---- storage (ring buffer) ----
const MAX_EVENTS = Number(process.env.EVENTS_MAX ?? 1000);
const events: EventItem[] = [];

function pushEvent(e: EventItem) {
  events.push(e);
  const overflow = events.length - MAX_EVENTS;
  if (overflow > 0) events.splice(0, overflow);
}

function lastN(n: number): EventItem[] {
  const m = Math.max(1, Math.min(n, MAX_EVENTS));
  return events.slice(Math.max(0, events.length - m)).reverse();
}

function sinceTs(ts: number, cap = 200): EventItem[] {
  if (!Number.isFinite(ts) || ts <= 0) return [];
  const out: EventItem[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < cap; i--) {
    const ev = events[i];
    if (Date.parse(ev.at) <= ts) break;
    out.push(ev);
  }
  return out.reverse();
}

// ---- routes ----
r.get("/ping", (_req, res) => res.json({ pong: true, at: new Date().toISOString() }));

// POST /api/events/put  { kind, at?, data?, user? }  or  { events:[...] }
r.post("/put", requireAdmin, (req: Request, res: Response) => {
  try {
    const nowIso = new Date().toISOString();
    const body: any = req.body || {};
    const add = (raw: any) => {
      const kind = String(raw?.kind || "").trim();
      if (!kind) return 0;
      const at = String(raw?.at || nowIso);
      const user = typeof raw?.user === "string" ? raw.user : undefined;
      const data = (raw?.data && typeof raw.data === "object") ? (raw.data as Json) : undefined;
      pushEvent({ kind, at, user, data });
      return 1;
    };
    let inserted = 0;
    if (Array.isArray(body?.events)) for (const x of body.events) inserted += add(x);
    else inserted += add(body);
    res.json({ ok: true, inserted });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "put_failed", detail: String(e?.message || e) });
  }
});

r.get("/recent", requireAdmin, (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 50)));
  res.json({ ok: true, items: lastN(limit) });
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

// SSE stream (no auth; EventSource cannot send custom headers)
r.get("/stream", (req: Request, res: Response) => {
  try {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    (res as any).flushHeaders?.();

    const since = Number(req.query.since || 0);
    const backlog = Number.isFinite(since) && since > 0 ? sinceTs(since, 200) : lastN(20).reverse().reverse();
    for (const ev of backlog) {
      res.write("event: event\n");
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }

    const ping = setInterval(() => {
      try { res.write(`event: ping\ndata: {"t":${Date.now()}}\n\n`); } catch {}
    }, 25000);
    req.on("close", () => { clearInterval(ping); try { res.end(); } catch {} });
  } catch { try { res.end(); } catch {} }
});

export default r;