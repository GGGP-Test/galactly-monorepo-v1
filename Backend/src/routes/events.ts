// src/routes/events.ts
// Events store + SSE with forgiving auth AND backward-compat for /ingest.
// - Writes:
//     • POST /api/events/ingest  (allowed from localhost without keys; or admin key)
//     • POST /api/events/put      (admin key required if keys configured)
// - Reads (recent/stats):
//     • Require admin unless ADMIN_ALLOW_GUEST_READS=1
// - Stream (SSE): /api/events/stream  (guest if ADMIN_ALLOW_GUEST_READS=1)
//
// Accepted admin creds: x-admin-key, x-admin-token, Authorization: Bearer <key>, or ?key=
// Set ADMIN_AUTH_DEBUG=1 to inspect what server sees at /api/events/debug-auth

import { Router, type Request, type Response, type NextFunction } from "express";

type Json = Record<string, unknown>;
export interface EventItem {
  kind: string;
  at: string;               // ISO
  user?: string;
  host?: string | null;
  ip?: string | null;
  data?: Json;
}

const r = Router();

/* ----------------------------- auth helpers ----------------------------- */

const ADMIN_KEYS = new Set(
  [process.env.ADMIN_TOKEN, process.env.ADMIN_API_KEY, process.env.ADMIN_KEY]
    .map(s => (s || "").trim())
    .filter(Boolean)
);

const ALLOW_GUEST_READS = String(process.env.ADMIN_ALLOW_GUEST_READS || "") === "1";
const AUTH_DEBUG = String(process.env.ADMIN_AUTH_DEBUG || "") === "1";

function pickAdminKey(req: Request): string | undefined {
  const hKey = (req.header("x-admin-key") || "").trim();
  const hTok = (req.header("x-admin-token") || "").trim();
  const auth = (req.header("authorization") || "").trim();
  const q = String((req.query.key || req.query.k || "") || "").trim();
  if (hKey) return hKey;
  if (hTok) return hTok;
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (q) return q;
  return undefined;
}

function isLocal(req: Request): boolean {
  const ip = String(req.ip || req.socket.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.");
}

function requireAdmin(writeOnly = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If no keys configured, allow everything (dev/forgiving)
    if (ADMIN_KEYS.size === 0) return next();
    // Allow guest reads when explicitly enabled
    if (!writeOnly && ALLOW_GUEST_READS && req.method === "GET") return next();

    const got = pickAdminKey(req);
    if (!got || !ADMIN_KEYS.has(got)) {
      return res.status(401).json({
        ok: false,
        error: "unauthorized",
        hint: "send x-admin-key or x-admin-token or Authorization: Bearer <key> (or ?key= for GET)",
      });
    }
    next();
  };
}

// writes allowed from localhost w/out key OR with admin key
function requireLocalOrAdmin() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (ADMIN_KEYS.size === 0) return next();
    if (isLocal(req)) return next();
    const got = pickAdminKey(req);
    if (got && ADMIN_KEYS.has(got)) return next();
    return res.status(401).json({ ok: false, error: "unauthorized_write", hint: "localhost or admin key required" });
  };
}

/* -------------------------------- store -------------------------------- */

const MAX = Math.max(500, Number(process.env.EVENTS_MAX || 2000));
const items: EventItem[] = [];

function push(ev: EventItem) {
  items.push(ev);
  if (items.length > MAX) items.splice(0, items.length - MAX);
}

function lastN(n: number) {
  const k = Math.max(1, Math.min(n, MAX));
  // newest first
  return items.slice(Math.max(0, items.length - k)).reverse();
}

function sinceTs(ts: number, cap = 200) {
  if (!Number.isFinite(ts) || ts <= 0) return [];
  const out: EventItem[] = [];
  for (let i = items.length - 1; i >= 0 && out.length < cap; i--) {
    const ev = items[i];
    if (Date.parse(ev.at) <= ts) break;
    out.push(ev);
  }
  return out.reverse(); // oldest-first
}

function s(v: unknown): string { return (v == null ? "" : String(v)).trim(); }
function toIso(d?: string): string {
  if (!d) return new Date().toISOString();
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}
function safeData(v: any) {
  try {
    const s = JSON.stringify(v);
    if (s.length > 8192) return { note: "truncated", size: s.length };
    return v;
  } catch { return { note: "unserializable" }; }
}

/* -------------------------------- routes ------------------------------- */

r.get("/ping", (_req, res) => res.json({ pong: true, at: new Date().toISOString() }));

// ---- WRITE (admin) --------------------------------------------------------
// POST /api/events/put { kind, at?, user?, host?, data? } OR { events:[...] }
r.post("/put", requireAdmin(true), (req, res) => {
  try {
    const body: any = req.body || {};
    const nowIso = new Date().toISOString();

    const add = (raw: any) => {
      if (!raw || typeof raw !== "object") return 0;
      const kind = s(raw.kind || raw.type);
      if (!kind) return 0;
      push({
        kind,
        at: s(raw.at || raw.ts) || nowIso,
        user: typeof raw.user === "string" ? raw.user : undefined,
        host: s(raw.host) || null,
        ip: s((req.ip || req.socket.remoteAddress) as any) || null,
        data: typeof raw.data === "object" ? (safeData(raw.data) as Json) : undefined,
      });
      return 1;
    };

    let inserted = 0;
    if (Array.isArray(body?.events)) for (const e of body.events) inserted += add(e);
    else inserted += add(body);

    res.json({ ok: true, inserted });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "put_failed", detail: String(e?.message || e) });
  }
});

// ---- WRITE (local/open for internal emitters) -----------------------------
// POST /api/events/ingest  (compat for other routes already emitting here)
r.post("/ingest", requireLocalOrAdmin(), (req, res) => {
  try {
    const body: any = req.body || {};
    const nowIso = new Date().toISOString();

    const add = (raw: any) => {
      if (!raw || typeof raw !== "object") return 0;
      const kind = s(raw.kind || raw.type);
      if (!kind) return 0;
      push({
        kind,
        at: s(raw.at || raw.ts) || nowIso,
        user: typeof raw.user === "string" ? raw.user : undefined,
        host: s(raw.host) || null,
        ip: s((req.ip || req.socket.remoteAddress) as any) || null,
        data: typeof raw.data === "object" ? (safeData(raw.data) as Json) : undefined,
      });
      return 1;
    };

    let inserted = 0;
    if (Array.isArray(body?.events)) for (const e of body.events) inserted += add(e);
    else inserted += add(body);

    res.json({ ok: true, inserted, mode: isLocal(req) ? "local" : "admin" });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "ingest_failed", detail: String(e?.message || e) });
  }
});

// ---- READ -----------------------------------------------------------------
r.get("/recent", (req, res, next) => {
  if (!(ADMIN_KEYS.size === 0 || ALLOW_GUEST_READS)) return requireAdmin(false)(req, res, next);
  next();
}, (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
  const kind = s(req.query.kind);
  const host = s(req.query.host);

  let out = lastN(limit);
  if (kind) out = out.filter(e => e.kind === kind);
  if (host) out = out.filter(e => (e.host || "") === host);

  res.json({ ok: true, returned: out.length, items: out });
});

r.get("/stats", (req, res, next) => {
  if (!(ADMIN_KEYS.size === 0 || ALLOW_GUEST_READS)) return requireAdmin(false)(req, res, next);
  next();
}, (_req, res) => {
  const by: Record<string, number> = {};
  for (const e of items) by[e.kind] = (by[e.kind] || 0) + 1;
  res.json({
    ok: true,
    total: items.length,
    counts: by,
    since: items[0]?.at ?? null,
    latest: items.at(-1)?.at ?? null
  });
});

// ---- STREAM (SSE) ---------------------------------------------------------
r.get("/stream", (req, res, next) => {
  if (!(ADMIN_KEYS.size === 0 || ALLOW_GUEST_READS)) return requireAdmin(false)(req, res, next);
  next();
}, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  (res as any).flushHeaders?.();

  const since = Number(req.query.since || 0);
  const backlog = Number.isFinite(since) && since > 0 ? sinceTs(since, 200) : lastN(20).slice().reverse(); // oldest-first
  for (const ev of backlog) {
    res.write("event: event\n");
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
  const ping = setInterval(() => {
    try { res.write(`event: ping\ndata: {"t":${Date.now()}}\n\n`); } catch {}
  }, 25000);
  req.on("close", () => { clearInterval(ping); try { res.end(); } catch {} });
});

// ---- DEBUG ----------------------------------------------------------------
r.get("/debug-auth", (req, res) => {
  if (!AUTH_DEBUG) return res.status(404).end();
  res.json({
    adminKeysConfigured: ADMIN_KEYS.size,
    got: {
      "x-admin-key": req.header("x-admin-key") || null,
      "x-admin-token": req.header("x-admin-token") || null,
      authorization: req.header("authorization") || null,
      keyParam: (req.query.key as string) || (req.query.k as string) || null,
      ip: req.ip || req.socket.remoteAddress || null,
      allowGuestReads: ALLOW_GUEST_READS,
    },
  });
});

export default r;