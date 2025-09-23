// src/routes/buyers.ts
import { Router, Request, Response } from "express";
import { findBuyerLead, runProviders, listProviders } from "../core/providers";

const router = Router();

/* -------------------------- tiny helpers -------------------------- */

type Temp = "hot" | "warm" | "cold";
type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;    // ISO
  temp?: Temp | string;
  whyText?: string;
  score?: number;
};

type ApiOk = { ok: true; items: LeadItem[] };
type ApiErr = { ok: false; error: string };

function bad(res: Response, msg: string, code = 400) {
  const body: ApiErr = { ok: false, error: msg };
  return res.status(code).json(body);
}

function pickParams(req: Request) {
  const q = Object.assign({}, req.query, req.body);
  const raw = String(q.host ?? q.supplier ?? "").trim().toLowerCase();
  const host = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const region = String(q.region ?? "US/CA").trim();
  const radius = String(q.radius ?? q.radiusMi ?? "50 mi").trim();
  const topK = Math.max(1, Math.min(3, Number(q.topK ?? 1) || 1)); // cap small for now
  return { host, region, radius, topK };
}

/* --------------------------- diagnostics -------------------------- */

// GET /api/providers  ->  ["shim", "rss", ...]
router.get("/providers", (_req, res) => {
  res.json({ ok: true, providers: listProviders() });
});

/* -------------------------- find endpoints ------------------------ */
/**
 * All return the same shape: { ok: true, items: [LeadItem, ...] }
 * We support both GET and POST and several path aliases so the panel
 * and your probes always get a 2xx when correctly called.
 */

// /api/buyers/find-one  (single lead)
router.get("/buyers/find-one", handleFindOne);
router.post("/buyers/find-one", handleFindOne);

// /api/buyers/find     (single lead; alias)
router.get("/buyers/find", handleFindOne);
router.post("/buyers/find", handleFindOne);

// /api/buyers/find-buyers (topK leads; today defaults to 1)
router.get("/buyers/find-buyers", handleFindMany);
router.post("/buyers/find-buyers", handleFindMany);

// Also expose short aliases at /api/find* so /routes probe remains happy
router.get("/find-one", handleFindOne);
router.post("/find-one", handleFindOne);
router.get("/find", handleFindOne);
router.post("/find", handleFindOne);
router.get("/find-buyers", handleFindMany);
router.post("/find-buyers", handleFindMany);

/* ---------------------------- handlers ---------------------------- */

async function handleFindOne(req: Request, res: Response) {
  const { host, region, radius } = pickParams(req);
  if (!host) return bad(res, "host is required");
  try {
    const lead = await findBuyerLead(host, region, radius);
    const body: ApiOk = { ok: true as const, items: [lead] };
    return res.json(body);
  } catch (e: any) {
    return bad(res, e?.message ?? "internal error", 500);
  }
}

async function handleFindMany(req: Request, res: Response) {
  const { host, region, radius, topK } = pickParams(req);
  if (!host) return bad(res, "host is required");
  try {
    const items = await runProviders({ host, region, radius }, topK);
    const body: ApiOk = { ok: true as const, items };
    return res.json(body);
  } catch (e: any) {
    return bad(res, e?.message ?? "internal error", 500);
  }
}

export default router;