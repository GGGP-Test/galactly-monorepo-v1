// src/routes/status.ts
//
// Unified status route:
// - NEW:  GET /api/status           -> compact env/audit + quota snapshot
// - LEGACY: /api/v1/status          -> same shape you used before (uid/plan/quota)
// Backward compatible: exports a Router (default) AND an app-level registrar.
//
// Safe if shared/audit is missing; safe if no ctx is provided.

import { Router, type Request, type Response, type Express } from "express";
import { summarizeForHealth } from "../shared/env";

// ---- Optional audit import (don’t crash if absent) --------------------------
let Audit: any = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Audit = require("../shared/audit");
} catch {
  /* optional */
}

// ---- Legacy ctx types (kept for compatibility) ------------------------------
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

// ---- tiny utils --------------------------------------------------------------
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
  // Prefer ctx.quota if present
  if (ctx?.quota && typeof ctx.quota.status === "function") {
    try { return await ctx.quota.status(uid); } catch { /* fall through */ }
  }
  // Fallback: devUnlimited => big numbers; else defaults (3 reveals / 30 finds)
  const unlimited = !!ctx?.devUnlimited;
  return {
    revealsLeft: unlimited ? 9_999 : 3,
    findsLeft:   unlimited ? 9_999 : 30,
  };
}

// ---- Router (mounted at /api/status in index.ts) ----------------------------
const r = Router();

r.get("/", async (req: Request, res: Response) => {
  try {
    const env = summarizeForHealth?.() ?? {};
    const a = auditSnapshot();
    const uid = uidFrom(req);
    // We don’t have ctx here in router form; provide neutral quota so dashboards work.
    const quota = await quotaFor(uid, undefined);

    res.json({
      ok: true,
      now: new Date().toISOString(),
      env,
      audit: {
        ok: !!a.ok || true,
        totals: a.totals || {},
        byType: a.byType || {},
        recent: Array.isArray(a.recent) ? a.recent.slice(-10) : [],
        count: num(a.totals?.all ?? a.count ?? 0),
      },
      uid,
      plan: "free",
      quota,
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
});

export default r;

// ---- Legacy registrar (adds /api/v1/status for old callers) -----------------
export function registerStatusRoutes(app: Express, ctx?: Ctx) {
  app.get("/api/v1/status", async (req: Request, res: Response) => {
    try {
      const uid = uidFrom(req);
      const quota = await quotaFor(uid, ctx);
      res.json({ ok: true, uid, plan: "free", quota, devUnlimited: !!ctx?.devUnlimited });
    } catch (err: any) {
      res.status(200).json({ ok: false, error: String(err?.message || err) });
    }
  });
}