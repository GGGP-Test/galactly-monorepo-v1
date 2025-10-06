// Backend/src/shared/plan-flags.ts
//
// Centralized plan flags & limits (free/pro/scale) with tiny in-memory store.
// - Used by routes to gate features and set limits
// - Stripe webhook (later) will call setPlanForEmail()/setPlanForDomain()
// - Optional persistence to JSON via PLAN_FLAGS_FILE (absolute or relative path)
//
// No external deps.

import fs from "fs";
import path from "path";

export type PlanTier = "free" | "pro" | "scale";

export type PlanFlags = {
  plan: PlanTier;
  // hard limits / quotas
  limits: {
    leadsPerDay: number;          // batch API or per-user daily cap
    streamCooldownSec: number;    // SSE “find/stream” cooldown
    maxConcurrentFinds: number;   // parallel “find buyers” calls
  };
  // toggles for features
  features: {
    fastLane: boolean;            // lower cooldowns, priority
    dir2Collectors: boolean;      // platform-side collectors (ads/meta/google etc.)
    exportsCSV: boolean;          // CSV export
    contactResolver: boolean;     // external vendors (Apollo/Clearbit/etc.)
  };
};

/** Default flags per tier (edit safely) */
export const DEFAULTS: Record<PlanTier, PlanFlags> = {
  free: {
    plan: "free",
    limits: {
      leadsPerDay: 50,
      streamCooldownSec: 45,
      maxConcurrentFinds: 2,
    },
    features: {
      fastLane: false,
      dir2Collectors: false,
      exportsCSV: true,
      contactResolver: false,
    },
  },
  pro: {
    plan: "pro",
    limits: {
      leadsPerDay: 1000,
      streamCooldownSec: 8,
      maxConcurrentFinds: 6,
    },
    features: {
      fastLane: true,
      dir2Collectors: true,
      exportsCSV: true,
      contactResolver: true,
    },
  },
  scale: {
    plan: "scale",
    limits: {
      leadsPerDay: 10000,
      streamCooldownSec: 3,
      maxConcurrentFinds: 12,
    },
    features: {
      fastLane: true,
      dir2Collectors: true,
      exportsCSV: true,
      contactResolver: true,
    },
  },
};

// ---- tiny store -------------------------------------------------------------

type Who = { email?: string; domain?: string };

type StoreRec = { plan: PlanTier; updatedAt: string; note?: string };
type StoreShape = { byEmail: Record<string, StoreRec>; byDomain: Record<string, StoreRec> };

const STORE: StoreShape = { byEmail: Object.create(null), byDomain: Object.create(null) };

function nowISO() { return new Date().toISOString(); }
function normEmail(e?: string) { return String(e || "").trim().toLowerCase(); }
function normDomain(d?: string) {
  const s = String(d || "").trim().toLowerCase();
  return s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function planFromEnvFallback(): PlanTier {
  const v = String(process.env.DEFAULT_PLAN || "free").toLowerCase();
  return (v === "pro" || v === "scale") ? (v as PlanTier) : "free";
}

function mergeFlags(base: PlanFlags, patch?: Partial<PlanFlags>): PlanFlags {
  if (!patch) return base;
  const out: PlanFlags = JSON.parse(JSON.stringify(base));
  if (patch.plan) out.plan = patch.plan;
  if (patch.limits) Object.assign(out.limits, patch.limits);
  if (patch.features) Object.assign(out.features, patch.features);
  return out;
}

// ---- public API -------------------------------------------------------------

/** Compute flags for a user/company from email+domain, falling back to defaults. */
export function flagsFor(who: Who, overrides?: Partial<PlanFlags>): PlanFlags {
  const email = normEmail(who.email);
  const domain = normDomain(who.domain || (email.includes("@") ? email.split("@")[1] : ""));
  const rec = (email && STORE.byEmail[email]) || (domain && STORE.byDomain[domain]);

  const tier: PlanTier = rec?.plan || planFromEnvFallback();
  const base = DEFAULTS[tier] || DEFAULTS.free;
  return mergeFlags(base, overrides);
}

/** Set plan for an email (used by Stripe webhooks on checkout/upgrade/cancel). */
export function setPlanForEmail(email: string, plan: PlanTier, note?: string) {
  const e = normEmail(email);
  if (!e) return;
  STORE.byEmail[e] = { plan, updatedAt: nowISO(), note };
}

/** Set plan for a domain (alternative to email-based mapping). */
export function setPlanForDomain(domain: string, plan: PlanTier, note?: string) {
  const d = normDomain(domain);
  if (!d) return;
  STORE.byDomain[d] = { plan, updatedAt: nowISO(), note };
}

/** Snapshot for debugging/admin. */
export function dumpPlanStore(limit = 50) {
  const out: Array<{ key: string; plan: PlanTier; updatedAt: string; scope: "email" | "domain" }> = [];
  for (const [k, v] of Object.entries(STORE.byEmail)) {
    out.push({ key: k, plan: v.plan, updatedAt: v.updatedAt, scope: "email" });
    if (out.length >= limit) return out;
  }
  for (const [k, v] of Object.entries(STORE.byDomain)) {
    out.push({ key: k, plan: v.plan, updatedAt: v.updatedAt, scope: "domain" });
    if (out.length >= limit) return out;
  }
  return out;
}

/** Simple feature check */
export function isFeatureEnabled(feature: keyof PlanFlags["features"], f: PlanFlags): boolean {
  return !!f.features[feature];
}

/** Optional JSON persistence (call on boot & after webhook changes). */
export function loadPlanStoreFromFile(file = String(process.env.PLAN_FLAGS_FILE || "")): boolean {
  if (!file) return false;
  try {
    const abs = path.isAbsolute(file) ? file : path.resolve(file);
    const txt = fs.readFileSync(abs, "utf8");
    const json = JSON.parse(txt) as StoreShape;
    if (json?.byEmail) STORE.byEmail = json.byEmail;
    if (json?.byDomain) STORE.byDomain = json.byDomain;
    return true;
  } catch { return false; }
}

export function savePlanStoreToFile(file = String(process.env.PLAN_FLAGS_FILE || "")): boolean {
  if (!file) return false;
  try {
    const abs = path.isAbsolute(file) ? file : path.resolve(file);
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(STORE, null, 2), "utf8");
    return true;
  } catch { return false; }
}