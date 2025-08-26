import { Router, Request, Response } from "express";
import { cseSearch, dedupe, serverFilter, CseType, LeadItem } from "../connectors/cse";


export const leadsRouter = Router();


// GET /api/v1/peek?q=...&type=web|linkedin|youtube&limit=10
leadsRouter.get("/peek", async (req: Request, res: Response) => {
try {
const q = String(req.query.q || "packaging buyers RFP");
const type = String(req.query.type || "web") as CseType;
const limit = Math.max(1, Math.min(Number(req.query.limit || 10), 10));
const data = await cseSearch({ q, type, limit });
const items = serverFilter(dedupe(data));
res.json({ ok: true, count: items.length, items });
} catch (err) {
res.status(500).json({ ok: false, error: String((err as Error).message || err) });
}
});


// GET /api/v1/leads?limit=20&q=...
leadsRouter.get("/leads", async (req: Request, res: Response) => {
try {
const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 50));
const q = String(
req.query.q ||
"packaging buyer OR procurement OR RFP site:gov OR site:linkedin.com OR site:reddit.com"
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
// server-side filter first, then dedupe, then cap to limit
const items = dedupe(serverFilter(merged)).slice(0, limit);
res.json({ ok: true, q, items, count: items.length });
} catch (err) {
res.status(500).json({ ok: false, error: String((err as Error).message || err) });
}
});


export default leadsRouter;
