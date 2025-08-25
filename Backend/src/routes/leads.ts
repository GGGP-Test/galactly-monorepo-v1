import { Router, Request, Response } from "express";
import { cseSearch, dedupe, CseType, LeadItem } from "../connectors/cse";
import { requireAuth } from "../auth";

export const leadsRouter = Router();

// all lead endpoints require auth
leadsRouter.use(requireAuth);

// GET /api/v1/leads?limit=20&q=...
leadsRouter.get("/leads", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 50));
    const q = String(
      req.query.q ||
        "packaging buyer OR copacker OR corrugated boxes OR cartons OR mailers OR RFP site:gov OR site:linkedin.com OR site:reddit.com"
    );

    const kinds: CseType[] = ["web", "linkedin", "youtube"];
    const batches = await Promise.all(
      kinds.map(async (type) => {
        const items = await cseSearch({ q, type, limit: Math.min(10, limit) });
        return items;
      })
    );

    let merged: LeadItem[] = [];
    for (const b of batches) merged = merged.concat(b);

    // filter: down-rank or drop generic .gov & sam.gov unless strongly relevant
    const strong = /(packag|copack|corrugat|carton|mailer|box|rfp|rfq)/i;
    function keep(it: LeadItem) {
      const host = (it.displayLink || it.url).toLowerCase();
      const text = `${it.title} ${it.snippet || ""}`;
      const isSam = /(^|[./])sam\.gov($|[/:])/i.test(host);
      const isGenericGov = /\.gov($|[/:])/i.test(host);
      if (isSam && !strong.test(text)) return false;
      if (isGenericGov && !strong.test(text)) return false;
      return true;
    }

    const items = dedupe(merged).filter(keep).slice(0, limit);
    res.json({ ok: true, q, items, count: items.length });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String((err as Error).message || err) });
  }
});

export default leadsRouter;
