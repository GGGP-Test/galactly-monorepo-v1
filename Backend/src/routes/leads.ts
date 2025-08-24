import { Router, Request, Response } from "express";
import { cseSearch, dedupe, CseType, LeadItem } from "../connectors/cse";

export const leadsRouter = Router();

/** ---------- Intent scoring tuned for PACKAGING “hot” leads ---------- */
type Scored = LeadItem & { score: number; reasons: string[] };

const INTENT_PHRASES: string[] = [
  "rfq","rfi","rfp","tender","bid",
  "request for quote","request for proposal","request for information",
  "seeking supplier","looking for supplier","vendor needed","supplier needed",
  "procurement","sourcing","buy packaging","purchase order","outsourcing",
  "contract packaging","co packer","co-packer","private label","white label"
];

const PACKAGING_TERMS: string[] = [
  "packaging","pouch","pouches","stand up pouch","spouted pouch","retort",
  "film","laminate","rollstock","sleeve","shrink sleeve","label","labels",
  "carton","folding carton","rigid box","corrugated","box","mailer","shipper",
  "crate","crating","ispm","pallet","void fill","foam","edge protector"
];

const NEGATIVE_TERMS: string[] = [
  "hiring","job opening","careers","internship","software developer",
  "design portfolio","stock photo","conference","webinar","how to",
  "recycling news","sustainability report","earnings","press release"
];

function lc(s: string) { return (s || "").toLowerCase(); }
function countHits(text: string, needles: string[]): number {
  let n = 0; const t = lc(text);
  for (const k of needles) { if (t.includes(k)) n++; }
  return n;
}

function scoreLead(it: LeadItem): { score: number; reasons: string[] } {
  const title = lc(it.title || "");
  const blurb = lc(it.snippet || "");
  const url = lc(it.url || "");
  const text = `${title} ${blurb} ${url}`;

  const reasons: string[] = [];
  let score = 0;

  // Core intent
  const intentHits = countHits(text, INTENT_PHRASES);
  if (intentHits) { score += intentHits * 25; reasons.push(`intent x${intentHits}`); }

  // Packaging relevance
  const packHits = countHits(text, PACKAGING_TERMS);
  if (packHits) { score += packHits * 10; reasons.push(`packaging x${packHits}`); }

  // Channel/domain boosts
  if (/(\brfp\b|\brfq\b|\/rfp\/|\/rfq\/)/.test(text)) { score += 20; reasons.push("rfp/rfq path"); }
  if (/\bsite:gov\b/.test(blurb) || /\.gov\b/.test(url)) { score += 25; reasons.push("gov domain"); }
  if (/linkedin\.com/.test(url)) { score += 10; reasons.push("linkedin"); }

  // Obvious negatives
  const negHits = countHits(text, NEGATIVE_TERMS);
  if (negHits) { score -= negHits * 20; reasons.push(`noise x${negHits}`); }

  // Very short / vague titles get a small penalty
  if ((it.title || "").trim().length < 20) { score -= 5; }

  // Clamp
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return { score, reasons };
}

/** Build a strong default query if caller didn’t pass ?q=... */
function defaultHotQuery(): string {
  const intent = [
    '"rfq"','"rfp"','"tender"','"request for quote"','"request for proposal"',
    '"procurement"','"sourcing"','"co packer"','"contract packaging"'
  ].join(" OR ");
  const pack = [
    "packaging","pouch","film","laminate","label","carton","corrugated","box","crate","pallet"
  ].join(" OR ");
  const domains = ["site:gov","site:linkedin.com","site:tenders","site:bid","site:procurement"].join(" OR ");
  return `(${intent}) (${pack}) (${domains})`;
}

/** ---------- Routes ---------- */

// GET /api/v1/peek?q=...&type=web|linkedin&limit=10  (unchanged but useful)
leadsRouter.get("/peek", async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "packaging buyers RFP");
    const type = String(req.query.type || "web") as CseType;
    const limit = Math.max(1, Math.min(Number(req.query.limit || 10), 10));
    const data = await cseSearch({ q, type, limit });
    res.json({ ok: true, count: data.length, items: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error).message || err) });
  }
});

// GET /api/v1/leads?limit=20&q=...&hot=1&channels=web,linkedin
// Returns scored leads (sorted desc). When hot=1 (default) filters to high score.
leadsRouter.get("/leads", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 50));
    const hot = String(req.query.hot || "1") !== "0";
    const q = String(req.query.q || defaultHotQuery());

    const channels = String(req.query.channels || "web,linkedin")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter((s): s is CseType => s === "web" || s === "linkedin");

    const batches = await Promise.all(
      channels.map(async (type) => cseSearch({ q, type, limit: Math.min(10, limit) }))
    );

    // Merge, dedupe, score, sort
    let merged: LeadItem[] = [];
    for (const b of batches) merged = merged.concat(b);
    const unique = dedupe(merged);

    const scored: Scored[] = unique.map(it => {
      const s = scoreLead(it);
      return { ...it, score: s.score, reasons: s.reasons };
    });

    scored.sort((a, b) => b.score - a.score);

    const threshold = Number(process.env.HOT_THRESHOLD || 55);
    const final = (hot ? scored.filter(i => i.score >= threshold) : scored).slice(0, limit);

    res.json({ ok: true, q, count: final.length, items: final, threshold });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error).message || err) });
  }
});

export default leadsRouter;
