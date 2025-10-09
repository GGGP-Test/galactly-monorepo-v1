// src/routes/status.ts
//
// Unified status route (compact, dependency-free):
// - GET  /api/status         → env summary, identity → plan flags, band gating, audit snapshot, quota
// - GET  /api/v1/status      → legacy shape (uid/plan/quota) + minimal gating
//
// Safe fallbacks if optional modules are absent (audit, plan store).
// Keeps your previous helpers (Ctx, attachQuotaHelpers) for compatibility.

import { Router, type Request, type Response, type Express } from "express";
import { summarizeForHealth } from "../shared/env";

// ---- optional audit (won't crash if missing) -------------------------------
let Audit: any = {};
try { Audit = require("../shared/audit"); } catch { /* optional */ }

// ---- plan flags + gating (adds value vs. your last file) -------------------
let Plan: any = {};
try { Plan = require("../shared/plan-flags"); } catch { /* optional; guarded below */ }

// ---- legacy ctx types (kept) -----------------------------------------------
export type Ctx = {
  users: Map<string, { reveals: number; finds: number }>;
  devUnlimited: boolean;
  quota?: {
    status(uid: string): Promise<{ revealsLeft: number; findsLeft: number }>;
  };
};

/** Keep old helper so existing callers don’t break. */
export function attachQuotaHelpers(ctx: Ctx) {
  const get = (uid: string) => ctx.users.get(uid) ?? { reveals: 0, finds: 0 };
  ctx.quota = {
    async status(uid: string) {
      const q = get(uid);
      return {
        revealsLeft: ctx.devUnlimited ? 9_999 : Math.max(0, 3 - q.reveals),
        findsLeft:   ctx.devUnlimited ? 9_999 : Math.max(0, 30 - q.finds),
      };
    },
  };
}

// ---- tiny utils -------------------------------------------------------------
function uidFrom(req: Request): string {
  return String(req.header("x-galactly-user") || req.header("x-user-id") || "anon");
}
function num(v: unknown, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function auditSnapshot() {
  try {
    if (typeof Audit?.snapshot === "function") return Audit.snapshot();
    const totals = Audit?.totals || {};
    const byType = Audit?.byType || {};
    const recent = Array.isArray(Audit?.recent) ? Audit.recent.slice(-20) : [];
    return { ok: true, totals, byType, recent };
  } catch { return { ok: false, totals: {}, byType: {}, recent: [] }; }
}
async function quotaFor(uid: string, ctx?: Ctx) {
  if (ctx?.quota && typeof ctx.quota.status === "function") {
    try { return await ctx.quota.status(uid); } catch { /* fall through */ }
  }
  const unlimited = !!ctx?.devUnlimited;
  return { revealsLeft: unlimited ? 9_999 : 3, findsLeft: unlimited ? 9_999 : 30 };
}

// ---- helpers for plan/gating (all optional) --------------------------------
type PlanTier = "free" | "pro" | "scale";
type Band = "HOT" | "WARM" | "COOL";
function readIdentity(headers: Record<string,string|undefined>) {
  if (Plan?.readIdentityFromHeaders) return Plan.readIdentityFromHeaders(headers);
  const h: Record<string,string> = {};
  for (const [k,v] of Object.entries(headers||{})) h[k.toLowerCase()] = String(v ?? "");
  const email = (h["x-user-email"]||"").toLowerCase();
  const plan: PlanTier = (["pro","scale"].includes((h["x-user-plan"]||"").toLowerCase())) ? (h["x-user-plan"] as PlanTier) : "free";
  const domain = (h["x-user-domain"] || (email.split("@")[1]||"")).toLowerCase();
  const adminOverride = !!h["x-admin-key"];
  return { email, domain, plan, adminOverride };
}
function flagsFor(who: {email?:string; domain?:string}, overrides?: any) {
  if (Plan?.flagsFor) return Plan.flagsFor(who, overrides);
  // safe default when plan-flags is missing
  return {
    plan: "free",
    limits: { leadsPerDay: 50, streamCooldownSec: 45, maxConcurrentFinds: 2 },
    features: { fastLane:false, dir2Collectors:false, exportsCSV:true, contactResolver:false },
  };
}
function summarizeGating(plan: PlanTier, requested: Band, adminOverride: boolean) {
  if (Plan?.summarizeGating) return Plan.summarizeGating(plan, requested, adminOverride);
  const allowed = requested !== "HOT" || plan !== "free" || adminOverride;
  return {
    bandRequested: requested,
    bandApplied: allowed ? requested : "WARM",
    gated: !allowed,
    plan,
    adminOverride,
    tiersApplied: plan === "free" ? ["C"] : plan === "pro" ? ["B","C"] : ["A","B","C"],
    preferTier: plan === "free" ? "C" : null,
  };
}

// ---- Router (mounted at /api/status) ---------------------------------------
const r = Router();

r.get("/", async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const env = summarizeForHealth?.() ?? {};
    const a = auditSnapshot();

    // identity → plan → flags → gating summaries
    const id = readIdentity(req.headers as any);
    const planFlags = flagsFor({ email: id.email, domain: id.domain });
    const reqBand = String(req.query.band || "HOT").toUpperCase() as Band;
    const band: Band = (reqBand === "HOT" || reqBand === "WARM" || reqBand === "COOL") ? reqBand : "HOT";

    const gating = {
      forRequested: summarizeGating(id.plan as PlanTier, band, id.adminOverride),
      forHOT:       summarizeGating(id.plan as PlanTier, "HOT",  id.adminOverride),
      forWARM:      summarizeGating(id.plan as PlanTier, "WARM", id.adminOverride),
      forCOOL:      summarizeGating(id.plan as PlanTier, "COOL", id.adminOverride),
    };

    // neutral quota (no ctx here)
    const uid = uidFrom(req);
    const quota = await quotaFor(uid, undefined);

    res.json({
      ok: true,
      now,
      env,
      identity: {
        email: id.email || null,
        domain: id.domain || null,
        headerPlan: id.plan,
        adminOverride: !!id.adminOverride,
      },
      plan: {
        plan: planFlags.plan,
        limits: planFlags.limits,
        features: planFlags.features,
      },
      gating,
      audit: {
        ok: !!a.ok || true,
        totals: a.totals || {},
        byType: a.byType || {},
        recent: Array.isArray(a.recent) ? a.recent.slice(-10) : [],
        count: num(a.totals?.all ?? a.count ?? 0),
      },
      uid,
      quota,
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "status-failed", detail: String(err?.message || err) });
  }
});

export default r;

// ---- Legacy registrar (adds /api/v1/status for old callers) ----------------
export function registerStatusRoutes(app: Express, ctx?: Ctx) {
  app.get("/api/v1/status", async (req: Request, res: Response) => {
    try {
      const uid = uidFrom(req);
      const quota = await quotaFor(uid, ctx);
      const id = readIdentity(req.headers as any);
      const gating = summarizeGating((id.plan as PlanTier) || "free", "HOT", !!id.adminOverride);
      res.json({ ok: true, uid, plan: id.plan || "free", quota, devUnlimited: !!ctx?.devUnlimited, gating });
    } catch (err: any) {
      res.status(200).json({ ok: false, error: "status-failed", detail: String(err?.message || err) });
    }
  });
}