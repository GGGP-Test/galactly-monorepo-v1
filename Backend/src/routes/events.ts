// src/routes/events.ts
// Events store + SSE with very forgiving admin auth.
// Accepts: x-admin-key, x-admin-token, Authorization: Bearer <key>, or ?key=<key>
// Optional: ADMIN_ALLOW_GUEST_READS=1 lets anyone read /recent and /stats.

import { Router, type Request, type Response, type NextFunction } from "express";

type Json = Record<string, unknown>;
export interface EventItem { kind: string; at: string; user?: string; data?: Json }

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
  // headers
  const hKey = (req.header("x-admin-key") || "").trim();
  const hTok = (req.header("x-admin-token") || "").trim();
  const auth = (req.header("authorization") || "").trim();
  // query fallback for GETs (handy for debugging)
  const q = (req.query.key || req.query.k || "") as string;
  const qKey = (q || "").trim();

  if (hKey) return hKey;
  if (hTok) return hTok;
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (qKey) return qKey;
  return undefined;
}

function requireAdmin(writeOnly = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If no admin keys configured, allow everything (dev mode)
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

/* -------------------------------- store -------------------------------- */

const MAX = Number(process.env.EVENTS_MAX || 2000);
const items: EventItem[] = [];

function push(ev: EventItem) {
  items.push(ev);
  if (items.length > MAX) items.splice(0, items.length - MAX);
}
function lastN(n: number) { return items.slice(Math.max(0, items.length - Math.max(1, Math.min(n, MAX)))).reverse(); }
function sinceTs(ts: number, cap = 200) {
  if (!Number.isFinite(ts) || ts <= 0) return [];
  const out: EventItem[] = [];
  for (let i = items.length - 1; i >= 0 && out.length < cap; i--) {
    const ev = items[i];
    if (Date.parse(ev.at) <= ts) break;
    out.push(ev);
  }
  return out.reverse();
}

/* -------------------------------- routes ------------------------------- */

r.get("/ping", (_req, res) => res.json({ pong: true, at: new Date().toISOString() }));

r.post("/put", requireAdmin(true), (req, res) => {
  try {
    const body: any = req.body || {};
    const nowIso = new Date().toISOString();

    const add = (raw: any) => {
      if (!raw || typeof raw !== "object") return 0;
      const kind = String((raw as any).kind || (raw as any).type || "").trim();
      if (!kind) return 0;
      push({
        kind,
        at: String((raw as any).at || (raw as any).ts || nowIso),
        user: typeof raw.user === "string" ? raw.user : undefined,
        data: typeof raw.data === "object" ? raw.data as Json : undefined,
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

r.get("/recent", requireAdmin(), (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
  res.json({ ok: true, items: lastN(limit) });
});

r.get("/stats", requireAdmin(), (_req, res) => {
  const by: Record<string, number> = {};
  for (const e of items) by[e.kind] = (by[e.kind] || 0) + 1;
  res.json({ ok: true, total: items.length, by, since: items[0]?.at ?? null, latest: items.at(-1)?.at ?? null });
});

// SSE (no custom headers possible in EventSource; rely on guest reads or unset keys)
r.get("/stream", (req, res) => {
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
});

// Optional debug: returns what the server *sees* (only if ADMIN_AUTH_DEBUG=1)
r.get("/debug-auth", (req, res) => {
  if (!AUTH_DEBUG) return res.status(404).end();
  res.json({
    adminKeysConfigured: ADMIN_KEYS.size,
    got: {
      "x-admin-key": req.header("x-admin-key") || null,
      "x-admin-token": req.header("x-admin-token") || null,
      authorization: req.header("authorization") || null,
      keyParam: (req.query.key as string) || (req.query.k as string) || null,
    },
  });
});

export default r;