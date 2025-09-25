// src/routes/leads.ts
import { Router, Request, Response } from "express";

/**
 * Types
 */
type Tier = "A" | "B" | "C";

type BuyerEntry = {
  host: string;
  name?: string;
  title?: string;
  tiers?: Tier[];
  segments?: string[];   // e.g., ["food","bakery"]
  tags?: string[];       // e.g., ["bag","label","shipper"]
  cityTags?: string[];   // e.g., ["los angeles","la"]
  vendorPaths?: string[]; // e.g., ["/wholesale","/press"]
};

type Catalog = {
  version?: number;
  buyers?: BuyerEntry[];
};

type Probe = {
  warm: boolean;
  hot: boolean;
  reasons: string[];
  smbLikely: boolean;
};

type ResultItem = {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: "hot" | "warm" | "cool";
  why: string;
  score: number;
};

const router = Router();

/**
 * Utils
 */
const ORDER: Tier[] = ["C", "B", "A"];

function norm(s?: string) {
  return (s || "").trim().toLowerCase();
}

function parseCatalog(raw?: string): Catalog {
  try {
    return raw ? JSON.parse(raw) as Catalog : { buyers: [] };
  } catch {
    return { buyers: [] };
  }
}

function tierPass(buyerTiers: Tier[] | undefined, minTier: Tier) {
  // If unknown, treat as C so Tier-C users still see it
  if (!buyerTiers || buyerTiers.length === 0) return minTier === "C";
  const best = Math.min(
    ...buyerTiers
      .map(t => ORDER.indexOf(t))
      .filter(i => i >= 0)
  );
  return best <= ORDER.indexOf(minTier);
}

function penalizeBigTiers(tiers?: Tier[]) {
  if (!tiers || tiers.length === 0) return 0;
  if (tiers.includes("A")) return -40;
  if (tiers.includes("B")) return -15;
  return 0;
}

function cityBoost(cityParam: string | undefined, cityTags?: string[]) {
  if (!cityParam || !cityTags?.length) return 0;
  const c = norm(cityParam);
  if (!c) return 0;
  const hit = cityTags.some(t => {
    const tt = norm(t);
    return tt === c || c.includes(tt) || tt.includes(c);
  });
  return hit ? 30 : 0;
}

/**
 * Very lightweight supplier persona guesser from host string.
 * (Just to bias tags/segments matching for Tier-C.)
 */
function guessSupplierPersona(host: string) {
  const h = norm(host);
  const seg = new Set<string>();
  const tg = new Set<string>();

  // Heuristics by common packaging vendor keywords
  if (h.includes("shrink") || h.includes("stretch")) {
    tg.add("shrink film").add("film").add("sleeve");
    seg.add("retail").add("food").add("beverage");
  }
  if (h.includes("label")) {
    tg.add("label");
    seg.add("cpg").add("beauty").add("beverage").add("food");
  }
  if (h.includes("box") || h.includes("carton") || h.includes("corr")) {
    tg.add("carton").add("rigid box").add("shipper").add("mailer");
    seg.add("dtc").add("home").add("electronics").add("bakery");
  }
  if (h.includes("tin") || h.includes("can")) {
    tg.add("can").add("sleeve").add("label");
    seg.add("beverage");
  }
  if (h.includes("bag")) {
    tg.add("bag").add("pouch");
    seg.add("snack").add("bakery").add("pet");
  }

  // Default general packaging
  if (seg.size === 0) seg.add("cpg");
  if (tg.size === 0) tg.add("label").add("shipper");

  return { segments: [...seg], tags: [...tg] };
}

/**
 * SMB/Warm/Hot signal detection from HTML
 */
function detectSignals(html: string): Probe {
  const lc = html.toLowerCase();
  const reasons: string[] = [];

  // SMB platforms
  const smbPlatforms = [
    "shopify", "woocommerce", "wp-content", "bigcommerce", "wix-static",
    "squarespace", "squa.re", "square.site", "webflow"
  ];
  const smb = smbPlatforms.some(p => lc.includes(p));
  if (smb) reasons.push("smb platform");

  // Pixels
  const pixelCues = [
    "fbevents.js", "fbq(", "gtag('config','aw-", "adsbygoogle", "ttq.track",
    "snaptr('track'", "linkedin.insight.min.js", "pintrk('track')"
  ];
  const pixels = pixelCues.some(p => lc.includes(p));
  if (pixels) reasons.push("ad pixel present");

  // Hot launch cues
  const hotWords = [
    "new launch", "now open", "grand opening", "coming soon", "pre-order",
    "preorder", "now available", "limited drop", "new menu", "new flavor",
    "holiday collection", "gift set", "back in stock"
  ];
  const hot = hotWords.some(w => lc.includes(w));
  if (hot) reasons.push("launch/event cue");

  // Warm content cues
  const warmWords = [
    "wholesale", "stockists", "become a supplier", "vendor", "suppliers",
    "distribution", "private label", "contract pack", "co-pack", "copack"
  ];
  const warm = hot || pixels || warmWords.some(w => lc.includes(w));

  return { warm, hot, reasons, smbLikely: smb };
}

/**
 * Environment catalogs
 */
const catA = parseCatalog(process.env.BUYERS_CATALOG_JSON);
const catC = parseCatalog(process.env.BUYERS_CATALOG_TIER_C_JSON);
const ALL_BUYERS: BuyerEntry[] = [
  ...(catA.buyers || []),
  ...(catC.buyers || [])
];

/**
 * GET /api/leads/find-buyers
 *  query:
 *   - host: supplier host (required)
 *   - city: optional (boost matches)
 *   - minTier: optional ("C" | "B" | "A") default "C"
 *   - limit: optional number (default 12)
 */
router.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  const host = norm(req.query.host as string);
  if (!host) {
    return res.status(400).json({ error: "host required", items: [] });
  }

  const minTier = (norm(req.query.minTier as string) as Tier) || "C";
  const city = norm(req.query.city as string);
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));

  // Persona guess from supplier host keywords
  const persona = guessSupplierPersona(host);
  const personaSeg = new Set(persona.segments.map(norm));
  const personaTags = new Set(persona.tags.map(norm));

  // Stage 1: pre-score from catalog facts (city + tier + static overlaps)
  const prelim = ALL_BUYERS
    .filter(b => tierPass(b.tiers, ["a","b","c"].includes(minTier) ? minTier : "C"))
    .map(b => {
      const base = 50;
      const tierPenalty = penalizeBigTiers(b.tiers);
      const cBoost = cityBoost(city, b.cityTags);

      // Overlap boosts
      const segOverlap = (b.segments || []).some(s => personaSeg.has(norm(s))) ? 18 : 0;
      const tagOverlap = (b.tags || []).some(t => personaTags.has(norm(t))) ? 14 : 0;

      const score = base + tierPenalty + cBoost + segOverlap + tagOverlap;

      return { buyer: b, score, why: [] as string[] };
    });

  // Sort high to low and take a wider batch for probing
  prelim.sort((a, b) => b.score - a.score);
  const probeBatch = prelim.slice(0, Math.max(limit * 2, 20));

  // Stage 2: probe pages for warm/hot/smb signals
  const results: ResultItem[] = [];
  for (const item of probeBatch) {
    const b = item.buyer;
    const vendorPaths = b.vendorPaths && b.vendorPaths.length > 0 ? b.vendorPaths : ["/", "/press", "/wholesale"];
    let html = "";

    // Try first reachable path (best effort; ignore fetch errors)
    for (const p of vendorPaths) {
      try {
        const url = `https://${b.host}${p}`;
        const r: any = await (globalThis as any).fetch(url, { method: "GET" });
        if (r && r.ok) {
          html = await r.text();
          break;
        }
      } catch {
        // ignore path errors
      }
    }

    const sig = detectSignals(html || "");
    if (sig.smbLikely) { item.score += 25; item.why.push("smb platform"); }
    if (sig.warm)      { item.score += 10; item.why.push("warm"); }
    if (sig.hot)       { item.score += 25; item.why.push("hot"); }
    item.why.push(...sig.reasons.filter(Boolean));

    // Compose result row
    const row: ResultItem = {
      host: b.host,
      platform: "web",
      title: b.title || (b.name ? `Suppliers | ${b.name}` : `Suppliers | ${b.host}`),
      created: new Date().toISOString(),
      temp: sig.hot ? "hot" : sig.warm ? "warm" : "cool",
      why: [
        ...(b.segments || []),
        ...(b.tags || []),
        ...(b.cityTags || []),
        ...item.why
      ].filter(Boolean).slice(0, 6).join(" · "),
      score: item.score
    };

    results.push(row);
    if (results.length >= limit) break;
  }

  // Final sort and respond
  results.sort((a, b) => b.score - a.score);
  return res.json({ items: results });
});

/**
 * POST /api/leads/lock
 *  body: { host: string, title: string, temp?: "hot"|"warm"|"cool" }
 *  (No persistence yet; returns OK so UI doesn't 400.)
 */
router.post("/api/leads/lock", async (req: Request, res: Response) => {
  const { host, title, temp } = (req.body || {}) as { host?: string; title?: string; temp?: string };
  if (!host || !title) {
    return res.status(400).json({ error: "candidate with host and title required" });
  }

  // Future: write to Neon (or queue) here.
  const savedAt = new Date().toISOString();
  return res.json({
    ok: true,
    saved: { host, title, temp: temp || "warm", savedAt }
  });
});

/**
 * Simple health endpoint so Dockerfile's healthcheck passes quickly.
 */
router.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

export default router;