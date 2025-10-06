// src/shared/flags.ts
//
// Plan + feature flags (single place to read/write).
// - In-memory map for V1 (per-pod). Swap with DB/KV later without touching callers.
// - Keyed by user email (or domain fallback).
// - Helpers for gating + safe defaults.
//
// Usage:
//   import { getPlan, setPlan, isPro, featureFlags } from "./shared/flags";
//
// Later (Stripe webhook):
//   setPlan(email, "pro", { source: "stripe", ref: session.id })

export type Plan = "free" | "pro" | "scale";

export type FlagBag = {
  plan: Plan;
  // quotas (example defaults; tune per product)
  dailyLeadCredits: number;
  maxExportsPerDay: number;
  fastLane: boolean;        // UI fast badge / reduced cooldowns
  adsScan: boolean;         // enable ads-intel lookups
  contactsVendors: Array<"generic-webhook" | "apollo" | "clearbit" | "instantly">;
  // trace
  updatedAtISO: string;
  source?: string;          // "manual" | "stripe" | "admin" | etc
  ref?: string;             // e.g. Stripe session/sub id
};

type Key = string; // email lowercased

const MEMORY = new Map<Key, FlagBag>();

function lc(s?: string) { return (s || "").trim().toLowerCase(); }

function defaults(plan: Plan): FlagBag {
  const base: Omit<FlagBag, "plan" | "updatedAtISO"> = {
    dailyLeadCredits: 25,
    maxExportsPerDay: 2,
    fastLane: false,
    adsScan: false,
    contactsVendors: ["generic-webhook"],
    source: "default",
    ref: undefined,
  };
  if (plan === "pro") {
    return {
      ...base,
      plan,
      dailyLeadCredits: 250,
      maxExportsPerDay: 25,
      fastLane: true,
      adsScan: true,
      contactsVendors: ["generic-webhook","apollo","clearbit","instantly"],
      updatedAtISO: new Date().toISOString(),
    };
  }
  if (plan === "scale") {
    return {
      ...base,
      plan,
      dailyLeadCredits: 2000,
      maxExportsPerDay: 200,
      fastLane: true,
      adsScan: true,
      contactsVendors: ["generic-webhook","apollo","clearbit","instantly"],
      updatedAtISO: new Date().toISOString(),
    };
  }
  return { ...base, plan, updatedAtISO: new Date().toISOString() };
}

/** canonical key (use email if present, else domain-ish) */
function keyFor(userEmail?: string, domainHint?: string): Key {
  const e = lc(userEmail);
  if (e) return e;
  const d = lc(domainHint).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return d || "anon";
}

/** Read-only accessor (always returns something). */
export function getPlan(userEmail?: string, domainHint?: string): FlagBag {
  const k = keyFor(userEmail, domainHint);
  const hit = MEMORY.get(k);
  return hit ?? defaults("free");
}

/** Set plan + flags (idempotent). */
export function setPlan(
  userEmail: string | undefined,
  plan: Plan,
  opts?: Partial<Pick<FlagBag,"source"|"ref">>
): FlagBag {
  const k = keyFor(userEmail);
  const current = MEMORY.get(k) ?? defaults("free");
  const next = { ...defaults(plan), source: opts?.source || current.source, ref: opts?.ref || current.ref };
  MEMORY.set(k, next);
  return next;
}

/** Merge/patch flags (leave plan as-is). */
export function patchFlags(
  userEmail: string | undefined,
  patch: Partial<FlagBag>
): FlagBag {
  const k = keyFor(userEmail);
  const cur = MEMORY.get(k) ?? defaults("free");
  const next: FlagBag = { ...cur, ...patch, updatedAtISO: new Date().toISOString() };
  MEMORY.set(k, next);
  return next;
}

/** Convenience booleans */
export function isPro(userEmail?: string, domainHint?: string): boolean {
  return getPlan(userEmail, domainHint).plan !== "free";
}
export function featureFlags(userEmail?: string, domainHint?: string) {
  return getPlan(userEmail, domainHint);
}

/** Dev/ops helpers */
export function __clearFlags() { MEMORY.clear(); }
export function __setRaw(k: string, v: FlagBag) { MEMORY.set(lc(k), v); }
export function __dump(limit = 100): Array<{ key: string; flags: FlagBag }> {
  const out: Array<{ key: string; flags: FlagBag }> = [];
  for (const [k, v] of MEMORY.entries()) {
    out.push({ key: k, flags: v });
    if (out.length >= limit) break;
  }
  return out;
}