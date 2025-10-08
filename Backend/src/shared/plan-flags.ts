// Backend/src/shared/plan-flags.ts
//
// Centralized plan flags, limits, and HOT/WARM/COOL gating.
// - In-memory store (V1) with optional JSON persistence via PLAN_FLAGS_FILE
// - Read plan from headers (x-user-email, x-user-plan); admin override if x-admin-key present
// - Band policy helpers for routes (free users can't request HOT unless admin override)
//
// No external deps.

import fs from "fs";
import path from "path";

/* -------------------------------------------------------------------------- */
/* Plan + feature flags                                                       */
/* -------------------------------------------------------------------------- */

export type PlanTier = "free" | "pro" | "scale";
export type Band = "HOT" | "WARM" | "COOL";

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

// Safe defaults for each plan
export const DEFAULTS: Record<PlanTier, PlanFlags> = {
  free: {
    plan: "free",
    limits: { leadsPerDay: 50, streamCooldownSec: 45, maxConcurrentFinds: 2 },
    features: { fastLane: false, dir2Collectors: false, exportsCSV: true, contactResolver: false },
  },
  pro: {
    plan: "pro",
    limits: { leadsPerDay: 1000, streamCooldownSec: 8, maxConcurrentFinds: 6 },
    features: { fastLane: true, dir2Collectors: true, exportsCSV: true, contactResolver: true },
  },
  scale: {
    plan: "scale",
    limits: { leadsPerDay: 10000, streamCooldownSec: 3, maxConcurrentFinds: 12 },
    features: { fastLane: true, dir2Collectors: true, exportsCSV: true, contactResolver: true },
  },
};

/* -------------------------------------------------------------------------- */
/* Tiny plan store (email + domain)                                           */
/* -------------------------------------------------------------------------- */

type Who = { email?: string; domain?: string };

type StoreRec = { plan: PlanTier; updatedAt: string; note?: string };
type StoreShape = { byEmail: Record<string, StoreRec>; byDomain: Record<string, StoreRec> };

const STORE: StoreShape = { byEmail: Object.create(null), byDomain: Object.create(null) };

const nowISO = () => new Date().toISOString();
const normEmail = (e?: string) => String(e || "").trim().toLowerCase();
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

/* -------------------------------------------------------------------------- */
/* Identity from headers + band policy                                        */
/* -------------------------------------------------------------------------- */

export function readIdentityFromHeaders(
  headers: Record<string, string | string[] | undefined>
): { email?: string; plan: PlanTier; adminOverride: boolean; domain?: string } {
  const h: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(headers || {})) {
    h[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  const email = normEmail(h["x-user-email"]);
  const domain = normDomain(h["x-user-domain"] || email.split("@")[1] || "");
  const rawPlan = String(h["x-user-plan"] || "").toLowerCase() as PlanTier;
  const plan: PlanTier = rawPlan === "pro" || rawPlan === "scale" ? rawPlan : "free";
  const adminOverride = !!h["x-admin-key"]; // presence is enough for route-level bypass
  return { email, plan, adminOverride, domain };
}

// Per-plan band allowances + preferred company tiers
const BAND_POLICY = {
  free: {
    allowed: new Set<Band>(["WARM", "COOL"]),
    tiers: ["C"],            // small companies only
    preferTier: "C" as "C" | null,
  },
  pro: {
    allowed: new Set<Band>(["HOT", "WARM", "COOL"]),
    tiers: ["B", "C"],       // mid + small
    preferTier: null as "C" | null,
  },
  scale: {
    allowed: new Set<Band>(["HOT", "WARM", "COOL"]),
    tiers: ["A", "B", "C"],  // all
    preferTier: null as "C" | null,
  },
};

export type BandDecision = {
  requested: Band;
  exactBand: Band;        // band the route should actually use
  gated: boolean;         // true if we downgraded due to plan
  tiersApplied: string[]; // subset of ["A","B","C"]
  preferTier: "C" | null;
};

export function applyBandPolicy(plan: PlanTier, requested: Band, adminOverride = false): BandDecision {
  const pol = BAND_POLICY[plan] || BAND_POLICY.free;
  const allowed = pol.allowed.has(requested);
  const gated = !adminOverride && !allowed;
  const exactBand: Band = gated && requested === "HOT" ? "WARM" : requested;
  return {
    requested,
    exactBand,
    gated,
    tiersApplied: pol.tiers.slice(),
    preferTier: pol.preferTier,
  };
}

export type GatingSummary = {
  bandRequested: Band;
  bandApplied: Band;
  gated: boolean;
  plan: PlanTier;
  adminOverride: boolean;
  tiersApplied: string[];
  preferTier: "C" | null;
};

export function summarizeGating(plan: PlanTier, requested: Band, adminOverride: boolean): GatingSummary {
  const d = applyBandPolicy(plan, requested, adminOverride);
  return {
    bandRequested: d.requested,
    bandApplied: d.exactBand,
    gated: d.gated,
    plan,
    adminOverride,
    tiersApplied: d.tiersApplied,
    preferTier: d.preferTier,
  };
}

/* -------------------------------------------------------------------------- */
/* Optional JSON persistence (boot & webhook save)                            */
/* -------------------------------------------------------------------------- */

function resolvePath(fileEnv?: string) {
  const f = String(fileEnv || process.env.PLAN_FLAGS_FILE || "").trim();
  if (!f) return "";
  return path.isAbsolute(f) ? f : path.resolve(f);
}

/** Load plan store from JSON file (shape { byEmail, byDomain }). */
export function loadPlanStoreFromFile(file?: string): boolean {
  const abs = resolvePath(file);
  if (!abs) return false;
  try {
    const txt = fs.readFileSync(abs, "utf8");
    const json = JSON.parse(txt) as Partial<StoreShape> | Record<string, StoreRec>;
    // Support both the new {byEmail,byDomain} shape and a legacy flat map
    if ((json as StoreShape).byEmail || (json as StoreShape).byDomain) {
      const j = json as StoreShape;
      if (j.byEmail) STORE.byEmail = j.byEmail;
      if (j.byDomain) STORE.byDomain = j.byDomain;
    } else {
      // legacy: { "user@x.com": {plan,...}, "acme.com": {plan,...} }
      const flat = json as Record<string, StoreRec>;
      for (const [k, v] of Object.entries(flat || {})) {
        if (k.includes("@")) STORE.byEmail[normEmail(k)] = v;
        else STORE.byDomain[normDomain(k)] = v;
      }
    }
    return true;
  } catch { return false; }
}

/** Save plan store to JSON file. */
export function savePlanStoreToFile(file?: string): boolean {
  const abs = resolvePath(file);
  if (!abs) return false;
  try {
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(STORE, null, 2), "utf8");
    return true;
  } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/* Default aggregate export                                                   */
/* -------------------------------------------------------------------------- */

export default {
  // flags
  flagsFor, setPlanForEmail, setPlanForDomain, dumpPlanStore, isFeatureEnabled,
  // identity + gating
  readIdentityFromHeaders, applyBandPolicy, summarizeGating,
  // persistence
  loadPlanStoreFromFile, savePlanStoreToFile,
  // types
};