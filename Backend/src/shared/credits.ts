// src/shared/credits.ts
//
// Daily credits (per email or domain) for "find" and "export".
// - In-memory store (per pod); safe to swap later with Redis/KV
// - Plans: free | pro | scale  (quotas align with plan-flags.ts)
// - API: checkAndConsume(), refund(), usage(), logAction(), getLog()
//
// How to use in a route:
//   import * as Credits from "../shared/credits";
//   const who = { email: req.header("x-user-email"), domain: req.query.host as string };
//   const plan = String(req.header("x-user-plan") || "free").toLowerCase() as Plan;
//   const gate = Credits.checkAndConsume(who, plan, "find", 1);
//   if (!gate.ok) return res.status(200).json({ ok:false, error:"quota", ...gate });
//
// Later (export):
//   const gate = Credits.checkAndConsume(who, plan, "export", items.length);
//
// Optional: surface Credits.getLog(who) in Free panel.

export type Plan = "free" | "pro" | "scale";
export type Op = "find" | "export";

export type Who = { email?: string | null; domain?: string | null };

export type Quotas = {
  dailyFind: number;
  dailyExport: number;
};

export type GateResult = {
  ok: boolean;
  remaining: { find: number; export: number };
  resetInSec: number;
  plan: Plan;
  usedToday: { find: number; export: number };
  detail?: string;
};

type DayKey = string;

type Counters = {
  day: DayKey;
  find: number;
  export: number;
  lastISO: string;
};

type LogRow = {
  at: string;
  op: Op | "log";
  count: number;
  plan: Plan;
  ok: boolean;
  msg?: string;
  host?: string;
  meta?: Record<string, unknown>;
};

// memory stores (per pod)
const COUNTS = new Map<string, Counters>(); // key: userKey
const LOGS = new Map<string, LogRow[]>();   // key: userKey (ring-bufferish)

function todayKey(): DayKey {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function nowISO(): string { return new Date().toISOString(); }

function lc(s?: string | null): string { return String(s || "").trim().toLowerCase(); }

function normDomain(input?: string | null): string {
  const s = lc(input);
  return s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function keyFor(who: Who): string {
  const e = lc(who.email);
  if (e) return e;
  const d = normDomain(who.domain);
  return d || "anon";
}

function quotasFor(plan: Plan): Quotas {
  // Keep aligned with Backend/src/shared/plan-flags.ts DEFAULTS
  if (plan === "scale") return { dailyFind: 10000, dailyExport: 200 };
  if (plan === "pro")   return { dailyFind: 1000,  dailyExport: 25  };
  // free
  return { dailyFind: 50, dailyExport: 2 };
}

function rolloverIfNeeded(k: string): Counters {
  const t = todayKey();
  const cur = COUNTS.get(k);
  if (!cur || cur.day !== t) {
    const next: Counters = { day: t, find: 0, export: 0, lastISO: nowISO() };
    COUNTS.set(k, next);
    return next;
  }
  return cur;
}

function remainingOf(c: Counters, q: Quotas) {
  return {
    find: Math.max(0, q.dailyFind - c.find),
    export: Math.max(0, q.dailyExport - c.export),
  };
}

function secondsUntilTomorrow(): number {
  const n = new Date();
  const t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0);
  return Math.max(1, Math.floor((t - n.getTime()) / 1000));
}

function pushLog(k: string, row: LogRow) {
  const arr = LOGS.get(k) || [];
  arr.push(row);
  if (arr.length > 200) arr.splice(0, arr.length - 200); // keep last 200
  LOGS.set(k, arr);
}

/** Consume N credits for op if available. */
export function checkAndConsume(
  who: Who,
  planIn: string | undefined,
  op: Op,
  n = 1,
  meta?: { host?: string; [k: string]: unknown }
): GateResult {
  const plan = (String(planIn || "free").toLowerCase() as Plan);
  const k = keyFor(who);
  const c = rolloverIfNeeded(k);
  const q = quotasFor(plan);
  const rem = remainingOf(c, q);

  let ok = false;
  if (op === "find") ok = rem.find >= n;
  else if (op === "export") ok = rem.export >= n;

  if (ok) {
    if (op === "find") c.find += n;
    else c.export += n;
    c.lastISO = nowISO();
  }

  const out: GateResult = {
    ok,
    remaining: remainingOf(c, q),
    resetInSec: secondsUntilTomorrow(),
    plan,
    usedToday: { find: c.find, export: c.export },
    detail: ok ? undefined : `insufficient_${op}_credits`,
  };

  pushLog(k, {
    at: nowISO(),
    op,
    count: n,
    plan,
    ok,
    msg: out.detail,
    host: meta?.host,
    meta,
  });

  return out;
}

/** Undo a prior consume (e.g., if export failed). */
export function refund(who: Who, op: Op, n = 1): void {
  const k = keyFor(who);
  const c = rolloverIfNeeded(k);
  if (op === "find") c.find = Math.max(0, c.find - n);
  else c.export = Math.max(0, c.export - n);
  c.lastISO = nowISO();
  pushLog(k, { at: nowISO(), op: "log", count: 0, plan: "free", ok: true, msg: `refund:${op}:${n}` });
}

/** Current counters + remaining for a plan (without consuming). */
export function usage(who: Who, planIn?: string): GateResult {
  const plan = (String(planIn || "free").toLowerCase() as Plan);
  const k = keyFor(who);
  const c = rolloverIfNeeded(k);
  const q = quotasFor(plan);
  return {
    ok: true,
    remaining: remainingOf(c, q),
    resetInSec: secondsUntilTomorrow(),
    plan,
    usedToday: { find: c.find, export: c.export },
  };
}

/** Append a simple action log row (for Free panel activity view). */
export function logAction(who: Who, note: string, meta?: Record<string, unknown>): void {
  const k = keyFor(who);
  rolloverIfNeeded(k);
  pushLog(k, { at: nowISO(), op: "log", count: 0, plan: "free", ok: true, msg: note, meta });
}

/** Return recent activity (last 200 rows) for UI/diagnostics. */
export function getLog(who: Who): LogRow[] {
  const k = keyFor(who);
  return (LOGS.get(k) || []).slice(-200);
}

/** Clear everything (tests/ops). */
export function __clearAll() { COUNTS.clear(); LOGS.clear(); }

/** Debug snapshot. */
export function __dump(limit = 100) {
  const out: Array<{ key: string; counters: Counters; logN: number }> = [];
  for (const [k, v] of COUNTS.entries()) {
    out.push({ key: k, counters: v, logN: (LOGS.get(k) || []).length });
    if (out.length >= limit) break;
  }
  return out;
}