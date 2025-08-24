import { Router } from "express";
import { cseSearch, dedupe, CseType, LeadItem } from "../connectors/cse";

export const leadsRouter = Router();

// GET /api/v1/peek?q=...&type=web|linkedin|youtube&limit=10
leadsRouter.get("/peek", async (req, res) => {
  try {
    const q = String(req.query.q || "packaging buyers RFP");
    const type = (String(req.query.type || "web") as CseType);
    const limit = Number(req.query.limit || 10);
    const data = await cseSearch({ q, type, limit });
    res.json({ ok: true, count: data.length, items: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error).message || err) });
  }
});

// GET /api/v1/leads?limit=20&q=...
leadsRouter.get("/leads", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 50));
    const q = String(req.query.q || "packaging buyer OR procurement OR RFP");
    const kinds: CseType[] = ["web", "linkedin", "youtube"];

    const batches = await Promise.all(
      kinds.map(async (type) => cseSearch({ q, type, limit: Math.min(10, limit) }))
    );

    const merged: LeadItem[] = dedupe(batches.flat()).slice(0, limit);
    res.json({ ok: true, q, items: merged, count: merged.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error).message || err) });
  }
});

export default leadsRouter;
