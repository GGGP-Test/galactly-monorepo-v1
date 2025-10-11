// src/routes/leads-claim.ts
//
// Endpoints that power the “Own” button and the competitor counter.
// - POST /api/leads/claim          -> claim/own a lead; optional VIP hide
// - POST /api/leads/claim/seen     -> log that a user has seen a lead (for counters)
// - GET  /api/leads/claim/status   -> status for a lead (hidden? competitor count?)
//
import express, { Request, Response } from "express";
import { quota } from "../shared/quota-store";

type Plan = "free" | "pro" | "vip";

// simple in-process stores (kept tiny; DB optional later)
type ClaimRec = { email: string; atMs: number; hide: boolean; hideUntilMs?: number; buyerHost?: string };
const CLAIMS = new Map<string, ClaimRec[]>();      // leadId -> claims
const HIDDEN = new Map<string, { by: string; untilMs: number }>(); // leadId -> hide info
const VIEWS  = new Map<string, Set<string>>();     // leadId -> unique viewers

const CLAIM_TTL_DAYS = Math.max(1, Number(process.env.CLAIM_TTL_DAYS || 30));
const router = express.Router();

// --- helpers ---------------------------------------------------------------
function now(){ return Date.now(); }
function iso(ms:number){ try{ return new Date(ms).toISOString(); }catch{ return ""; } }
function normEmail(h: any): string {
  const e = String(h || "").trim().toLowerCase();
  return e && e.includes("@") ? e : "";
}
function getPlanFromReq(req: Request): Plan {
  const raw = String((req.headers["x-user-plan"] || "free")).toLowerCase();
  if (raw === "vip") return "vip";
  if (raw === "pro") return "pro";
  return "free";
}
function planLimit(plan: Plan): number {
  // central place for daily caps (can be moved to plan engine later)
  if (plan === "vip") return 100;
  if (plan === "pro") return 25;
  return 3;
}
function competitorCount(leadId: string, owner: string): number {
  const viewers = VIEWS.get(leadId);
  if (viewers && viewers.size) {
    return Math.max(0, Array.from(viewers).filter(e => e !== owner).length);
  }
  const claimers = CLAIMS.get(leadId);
  if (claimers && claimers.length) {
    const uniq = new Set(claimers.map(c => c.email).filter(e => e !== owner));
    return uniq.size;
  }
  return 0;
}

// --- routes ----------------------------------------------------------------

/**
 * POST /api/leads/claim
 * body: { leadId: string, hide?: boolean, buyerHost?: string }
 *
 * Behavior:
 * - Requires x-user-email header (who is claiming).
 * - Checks daily quota (based on plan).
 * - Records the claim; if VIP + hide=true, hides the lead for CLAIM_TTL_DAYS.
 * - If already hidden by someone else, returns hidden info.
 */
router.post("/", express.json(), async (req: Request, res: Response) => {
  const email = normEmail(req.headers["x-user-email"]);
  if (!email) return res.status(200).json({ ok:false, error:"missing-email", detail:"x-user-email header required" });

  const plan = getPlanFromReq(req);
  const { leadId, hide, buyerHost } = Object(req.body || {});
  const id = String(leadId || "").trim();
  if (!id) return res.status(200).json({ ok:false, error:"bad-input", detail:"leadId required" });

  // if someone else is currently hiding it, block
  const hidden = HIDDEN.get(id);
  const nowMs = now();
  if (hidden && hidden.untilMs > nowMs && hidden.by !== email) {
    return res.status(200).json({
      ok:false,
      error:"hidden-by-competitor",
      hideUntil: iso(hidden.untilMs),
      competitorCount: competitorCount(id, email)
    });
  }

  // quota check
  const limit = planLimit(plan);
  const q = await quota.bump(email, plan, 1, { limit });
  if (!q.allowed) {
    return res.status(200).json({ ok:false, error:"quota", remaining:q.remaining, limit:q.limit });
  }

  // record claim
  const rec: ClaimRec = { email, atMs: nowMs, hide: !!hide, buyerHost: buyerHost || undefined };
  const arr = CLAIMS.get(id) || [];
  arr.push(rec);
  CLAIMS.set(id, arr);

  // apply VIP hide if requested and plan permits
  let hideApplied = false;
  let hideUntilIso: string | undefined;
  if (!!hide && plan === "vip") {
    const untilMs = nowMs + CLAIM_TTL_DAYS * 24 * 3600 * 1000;
    HIDDEN.set(id, { by: email, untilMs });
    rec.hideUntilMs = untilMs;
    hideApplied = true;
    hideUntilIso = iso(untilMs);
  }

  const comp = competitorCount(id, email);
  return res.status(200).json({
    ok: true,
    claimed: true,
    leadId: id,
    hideApplied,
    hideUntil: hideUntilIso,
    competitorCount: comp,
    quota: { remaining: q.remaining, limit: q.limit }
  });
});

/**
 * POST /api/leads/claim/seen
 * body: { leadId: string }
 * Lets us count “shown to N competitors” (unique viewers other than owner).
 */
router.post("/seen", express.json(), (req: Request, res: Response) => {
  const email = normEmail(req.headers["x-user-email"]); // can be empty if anonymous
  const id = String(req.body?.leadId || "").trim();
  if (!id) return res.status(200).json({ ok:false, error:"bad-input", detail:"leadId required" });
  if (email) {
    const set = VIEWS.get(id) || new Set<string>();
    set.add(email);
    VIEWS.set(id, set);
  }
  return res.status(200).json({ ok:true });
});

/**
 * GET /api/leads/claim/status?leadId=...
 * Returns whether a lead is hidden, until when, and competitor count.
 */
router.get("/status", (req: Request, res: Response) => {
  const email = normEmail(req.headers["x-user-email"]); // for competitor calc
  const id = String(req.query.leadId || "").trim();
  if (!id) return res.status(200).json({ ok:false, error:"bad-input", detail:"leadId required" });

  const hidden = HIDDEN.get(id);
  const nowMs = now();
  const activeHide = hidden && hidden.untilMs > nowMs ? { by:hidden.by, until: iso(hidden.untilMs) } : null;
  const comp = competitorCount(id, email || "");

  const claimers = CLAIMS.get(id) || [];
  const uniqueClaimers = new Set(claimers.map(c => c.email)).size;

  res.status(200).json({
    ok:true,
    leadId:id,
    hidden: !!activeHide,
    hideUntil: activeHide?.until,
    claimedByCount: uniqueClaimers,
    competitorCount: comp
  });
});

export default router;