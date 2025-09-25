// src/routes/leads.ts
import { Router, Request, Response } from "express";

/* ------------------------- Types & small helpers ------------------------- */

type Tier = "A" | "B" | "C";

type Buyer = {
  host: string;
  name?: string;
  tiers: Tier[];
  segments: string[];           // e.g. ["food","beverage","beauty","industrial"]
  tags?: string[];              // packaging hints: ["tin","shrink","glass","mailer"]
  cityTags?: string[];          // e.g. ["los angeles","nj","bay area","dallas"]
  vendorPaths?: string[];       // known supplier/vendor URLs to probe (optional)
};

type BuyersCatalog = { version: number; buyers: Buyer[] };

type Candidate = {
  host: string;
  platform: "web";
  title: string;
  created: string;              // ISO datetime
  temp: "warm" | "hot";
  why: string;
};

function nowIso() { return new Date().toISOString(); }

function decodeMaybeBase64(raw: string): string {
  const trimmed = raw.trim();
  const looksB64 = /^[A-Za-z0-9+/=]+$/.test(trimmed) && !trimmed.includes("{");
  if (!looksB64) return trimmed;
  try { return Buffer.from(trimmed, "base64").toString("utf8"); } catch { return trimmed; }
}

function loadBuyersCatalog(): BuyersCatalog {
  const fromEnv = process.env.BUYERS_CATALOG_JSON;
  if (fromEnv && fromEnv.trim()) {
    const txt = decodeMaybeBase64(fromEnv);
    return JSON.parse(txt);
  }
  // minimal fallback so the API still responds even if the secret is missing
  const fallback: BuyersCatalog = {
    version: 1,
    buyers: [
      {
        host: "generalmills.com",
        name: "General Mills",
        tiers: ["A"],
        segments: ["food","cpg"],
        tags: ["carton","pouch","film"],
        cityTags: ["minneapolis","mn","midwest"],
        vendorPaths: ["/suppliers","/vendors","/supplier-info"]
      },
      {
        host: "sallybeauty.com",
        name: "Sally Beauty",
        tiers: ["B"],
        segments: ["beauty","retail"],
        tags: ["bottle","jar","label","carton"],
        cityTags: ["denton","tx","dallas","north texas"],
        vendorPaths: ["/suppliers","/vendor","/supplier"]
      },
      {
        host: "kindsnacks.com",
        name: "KIND Snacks",
        tiers: ["B"],
        segments: ["food","snack","cpg"],
        tags: ["film","pouch","carton"],
        cityTags: ["new york","nyc","ny","manhattan"],
        vendorPaths: ["/suppliers","/vendor"]
      },
      {
        host: "califiafarms.com",
        name: "Califia Farms",
        tiers: ["B","C"],
        segments: ["beverage","cpg"],
        tags: ["bottle","label","shrink"],
        cityTags: ["los angeles","la","southern california","so cal"],
        vendorPaths: ["/suppliers","/supplier","/vendor"]
      },
      {
        host: "perfectsnacks.com",
        name: "Perfect Snacks",
        tiers: ["C"],
        segments: ["food","snack","cpg"],
        tags: ["film","pouch","case"],
        cityTags: ["san diego","sd","southern california"],
        vendorPaths: ["/suppliers","/vendor"]
      }
    ]
  };
  return fallback;
}

/* -------------------- Supplier → inferred tags/segments ------------------- */

function inferFromSupplierHost(host: string): {
  supplierTags: string[];
  supplierSegments: string[];
} {
  const h = host.toLowerCase();
  const tags = new Set<string>();
  const segs = new Set<string>();

  // segments (very coarse for now)
  if (/(food|snack|meal|cookie|bakery|meat|deli|grocery)/.test(h)) segs.add("food").add("cpg");
  if (/(beverage|drink|brew|coffee|tea|soda|juice|water)/.test(h)) segs.add("beverage").add("cpg");
  if (/(beauty|cosmetic|salon|hair|skincare|makeup|nail)/.test(h)) segs.add("beauty").add("retail");
  if (/(pharma|med|rx|lab|biotech)/.test(h)) segs.add("pharma").add("health");
  if (/(pet|animal|vet)/.test(h)) segs.add("pet").add("cpg");
  if (/(auto|automotive)/.test(h)) segs.add("auto");
  if (/(electronic|device|accessor|gadget)/.test(h)) segs.add("electronics");
  if (/(industrial|chemical|adhesive|coating|paint)/.test(h)) segs.add("industrial");
  if (segs.size === 0) segs.add("cpg"); // default broad bucket

  // packaging keywords → tags
  if (/(shrink|film|wrap)/.test(h)) tags.add("shrink").add("film");
  if (/(tin|metal|can)/.test(h)) tags.add("tin").add("can");
  if (/(glass|jar|vial)/.test(h)) tags.add("glass").add("jar");
  if (/(label|sticker)/.test(h)) tags.add("label");
  if (/(bottle|cap|closure)/.test(h)) tags.add("bottle");
  if (/(box|carton|mailer|corrug|ship)/.test(h)) tags.add("carton").add("mailer");
  if (/(pouch|sachet)/.test(h)) tags.add("pouch");
  if (/(tube)/.test(h)) tags.add("tube");
  if (tags.size === 0) tags.add("carton"); // sane default

  return { supplierTags: [...tags], supplierSegments: [...segs] };
}

/* ------------------------------- Scoring ---------------------------------- */

function scoreBuyer(b: Buyer, ctx: {
  supplierTags: string[];
  supplierSegments: string[];
  wantTiers: Tier[];
  cityHint?: string;
}): number {
  let s = 0;

  // tier fit
  if (b.tiers.some(t => ctx.wantTiers.includes(t))) s += 20;

  // segment overlap
  if (b.segments.some(seg => ctx.supplierSegments.includes(seg))) s += 25;

  // tag overlap
  if (b.tags && b.tags.some(t => ctx.supplierTags.includes(t))) s += 20;

  // city/local boost
  if (ctx.cityHint && b.cityTags?.some(c => ctx.cityHint!.includes(c))) s += 30;

  // very small diversity bonus for broader buyers
  if ((b.tags?.length ?? 0) >= 3) s += 5;

  return s;
}

/* -------------------------------- Router ---------------------------------- */

const router = Router();

/**
 * GET /api/leads/find-buyers?host=peekpackaging.com&region=US%2FCA&radius=50mi&city=los%20angeles
 * Responds: { items: Candidate[] }
 */
router.get("/find-buyers", async (req: Request, res: Response) => {
  const host = String(req.query.host || "").trim().toLowerCase();
  const region = String(req.query.region || "US/CA");
  const radius = String(req.query.radius || "50mi");
  const cityHint = (req.query.city ? String(req.query.city) : "").toLowerCase().trim() || undefined;

  if (!host) {
    res.status(400).json({ error: "host required", items: [] });
    return;
  }

  // broad desired tiers by region (tune as you like)
  const wantTiers: Tier[] = region === "US/CA" ? ["A","B","C"] : ["B","C"];

  const { supplierTags, supplierSegments } = inferFromSupplierHost(host);
  const catalog = loadBuyersCatalog();

  const scored = catalog.buyers.map(b => ({
    buyer: b,
    score: scoreBuyer(b, { supplierTags, supplierSegments, wantTiers, cityHint })
  }));

  // keep only relevant ones
  const kept = scored
    .filter(x => x.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const items: Candidate[] = kept.map(({ buyer, score }) => ({
    host: buyer.host,
    platform: "web",
    title: `Suppliers / vendor info | ${buyer.name ?? buyer.host}`,
    created: nowIso(),
    temp: score >= 75 ? "hot" as const : "warm" as const,
    why: [
      `fit: ${buyer.segments.join(", ")}`,
      `tiers: ${buyer.tiers.join("/")}`,
      cityHint && buyer.cityTags?.some(c => cityHint.includes(c)) ? `near: ${cityHint}` : undefined,
      buyer.tags && buyer.tags.length ? `packaging: ${buyer.tags.join(",")}` : undefined,
      `score: ${score}`
    ].filter(Boolean).join(" · ")
  }));

  // Your front-end prints "no candidate" on empty lists; keep 200 OK.
  res.json({ items, meta: { host, region, radius, city: cityHint, tags: supplierTags, segs: supplierSegments } });
});

/**
 * POST /api/leads/lock
 * Body: { host: string, title: string, temp?: "warm"|"hot" }
 * For now we acknowledge; you can wire to Neon later.
 */
router.post("/lock", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Partial<Candidate>;
  if (!body.host || !body.title) {
    res.status(400).json({ error: "candidate with host and title required" });
    return;
  }
  // TODO: insert into Neon (locked_leads) with user context when ready
  res.json({ ok: true, saved: { host: body.host, title: body.title, temp: body.temp ?? "warm", at: nowIso() } });
});

export default router;