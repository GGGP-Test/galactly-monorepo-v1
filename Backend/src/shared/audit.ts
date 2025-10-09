// src/shared/audit.ts
//
// Per-pod audit store + helpers (no external deps).
// - In-memory ring buffer (fast, deterministic)
// - record() updates local store and best-effort POSTs to /api/events/ingest
// - snapshot() returns compact shape used by routes/status.ts
// - Exposes totals/byType/recent for legacy readers
//
// Safe to import anywhere. If /api/events is mounted, this module
// will try to forward writes so the SSE/CSV/export also see them.

type Json = Record<string, unknown>;

export type AuditEvent = {
  id: string;
  ts: number;            // epoch ms
  type: string;          // event kind
  user?: string;
  path?: string;
  ip?: string | null;
  ua?: string;
  meta?: Json;
};

const MAX = Math.max(500, Number(process.env.EVENTS_MAX || 2000));
const PORT = Number(process.env.PORT || 8787);
const ADMIN_KEY =
  (process.env.ADMIN_API_KEY?.trim() ||
   process.env.ADMIN_TOKEN?.trim() ||
   process.env.ADMIN_KEY?.trim() ||
   "");

// local ring buffer
const _items: AuditEvent[] = [];
let _seq = 0;

// public mirrors (status.ts will read these if snapshot() isn’t used)
export const totals: { all: number } = { all: 0 };
export const byType: Record<string, number> = {};
export const recent: AuditEvent[] = []; // newest-first (capped ~100 for display)

function pushLocal(ev: AuditEvent) {
  _items.push(ev);
  if (_items.length > MAX) _items.splice(0, _items.length - MAX);

  // update mirrors
  totals.all = _items.length;
  byType[ev.type] = (byType[ev.type] || 0) + 1;

  // keep a small public-facing recent list (newest-first)
  recent.unshift(ev);
  if (recent.length > 100) recent.length = 100;
}

function nextId(): string {
  const n = (_seq = (_seq + 1) >>> 0);
  return `${Date.now().toString(36)}-${n.toString(36)}`;
}

function safeJson(v: unknown): Json | undefined {
  try {
    if (v == null) return undefined;
    const s = JSON.stringify(v);
    if (s.length > 8192) return { note: "truncated", size: s.length };
    return JSON.parse(s);
  } catch { return { note: "unserializable" }; }
}

// Best-effort forward to our own events endpoint (non-blocking)
async function forwardToEvents(ev: AuditEvent): Promise<void> {
  try {
    const url = `http://127.0.0.1:${PORT}/api/events/ingest`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ADMIN_KEY) headers["x-admin-key"] = ADMIN_KEY;
    // Fire-and-forget
    (globalThis as any).fetch?.(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: ev.type,
        at: new Date(ev.ts).toISOString(),
        user: ev.user,
        host: undefined,
        data: ev.meta,
      }),
      redirect: "follow",
    }).catch(() => void 0);
  } catch { /* ignore */ }
}

/** Record an event locally (and try to forward to /api/events). */
export function record(input: Partial<AuditEvent> & { type: string }): AuditEvent {
  const now = Date.now();
  const ev: AuditEvent = {
    id: input.id || nextId(),
    ts: Number.isFinite(input.ts) ? Number(input.ts) : now,
    type: String(input.type || "").trim() || "event",
    user: input.user ? String(input.user) : undefined,
    path: input.path ? String(input.path) : undefined,
    ip: input.ip ?? null,
    ua: input.ua ? String(input.ua) : undefined,
    meta: safeJson(input.meta),
  };
  pushLocal(ev);
  // don’t await; keep caller hot
  void forwardToEvents(ev);
  return ev;
}

/** Clear store (tests/ops). */
export function clear(): void {
  _items.length = 0;
  recent.length = 0;
  for (const k of Object.keys(byType)) delete byType[k];
  totals.all = 0;
}

/** Return newest N (newest-first). */
export function lastN(n = 50): AuditEvent[] {
  const k = Math.max(1, Math.min(n, MAX));
  return _items.slice(Math.max(0, _items.length - k)).reverse();
}

/** Lightweight stats summary. */
export function stats(): { total: number; counts: Record<string, number>; since: string | null; latest: string | null } {
  const counts: Record<string, number> = {};
  for (const e of _items) counts[e.type] = (counts[e.type] || 0) + 1;
  return {
    total: _items.length,
    counts,
    since: _items[0] ? new Date(_items[0].ts).toISOString() : null,
    latest: _items.length ? new Date(_items[_items.length - 1].ts).toISOString() : null,
  };
}

/** Snapshot used by routes/status.ts */
export function snapshot(): { ok: boolean; totals: { all: number }; byType: Record<string, number>; recent: AuditEvent[] } {
  // keep this synchronous
  return {
    ok: true,
    totals: { all: totals.all },
    byType: { ...byType },
    recent: lastN(20),
  };
}

export default { record, clear, lastN, stats, snapshot, totals, byType, recent };