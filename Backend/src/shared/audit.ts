// src/shared/audit.ts
//
// Zero-dep in-memory audit/event store used by:
//  - routes/events.ts (HTTP ingest + reads)
//  - routes/status.ts (snapshot for health)
//  - any module that wants to record lightweight events
//
// Exports:
//   record(kind, data?, meta?)       -> void
//   snapshot(maxRecent = 100)        -> { ok, totals, byType, recent }
//   clear()                          -> void
//   totals, byType, recent           -> live references (read-only by convention)

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type AuditEvent = {
  kind: string;
  at: string;                 // ISO timestamp
  ip?: string | null;
  data?: Json;
};

const MAX_RECENT = Math.max(100, Number(process.env.AUDIT_MAX_RECENT || 500));

export const recent: AuditEvent[] = [];
export const totals: Record<string, number> = Object.create(null);
export const byType: Record<string, number> = totals; // alias (compat)

function pushBounded(ev: AuditEvent) {
  recent.push(ev);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
}

export function record(kind: string, data?: Json, meta?: { ip?: string | null; at?: string }) {
  const k = String(kind || "").trim() || "event";
  const ev: AuditEvent = {
    kind: k,
    at: meta?.at && /^\d{4}-\d\d-\d\dT/.test(meta.at) ? meta.at : new Date().toISOString(),
    ip: meta?.ip ?? null,
    data,
  };
  pushBounded(ev);
  totals.all = (totals.all || 0) + 1;
  totals[k] = (totals[k] || 0) + 1;
}

/** Compact snapshot for UIs. Safe even if nothing recorded yet. */
export function snapshot(maxRecent = 100) {
  const n = Math.max(1, Math.min(MAX_RECENT, Number(maxRecent) || 100));
  return {
    ok: true,
    totals: { ...totals },
    byType: { ...totals },
    recent: recent.slice(-n),
  };
}

/** Clear all in-memory state (tests/ops). */
export function clear() {
  recent.length = 0;
  for (const k of Object.keys(totals)) delete totals[k];
}

export default { record, snapshot, clear, totals, byType, recent };