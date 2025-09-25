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

/**
 * User preference profile (what the user says “hot”/“warm” looks like)
 * NOTE: in-memory for now; later we can persist this to Neon.
 */
type PrefProfile = {
  id: string;
  city?: string;                // user’s preferred city (fallback if query ?city is missing)
  radiusMi?: number;            // (reserved)
  // Cues are plain substrings we’ll search in page HTML (case-insensitive)
  hotCues?: string[];           // “grand opening”, “new launch”, “pre-order”, etc.
  warmCues?: string[];          // “wholesale”, “private label”, etc.
  mustHave?: string[];          // if provided, at least one must appear to consider HOT
  preferSegments?: string[];    // e.g., ["beverage","bakery"]
  preferTags?: string[];        // e.g., ["label","carton"]
  avoidSegments?: string[];     // negative bias
  avoidTags?: string[];         // negative bias
  excludeGiants?: boolean;      // stronger penalty to Tier A
};

// ---- in-memory preference store ----
const PREFS = new Map<string, PrefProfile>();

/**
 * Utils
 */
const router = Router();
const ORDER: Tier[] = ["C", "B", "A"];

function norm(s?: string) {
  return (s || "").trim().toLowerCase();
}
function uniq(arr: string[]) {
  return Array.from(new Set(arr.map(norm))).filter(Boolean);
}
function parseCatalog(raw?: string): Catalog {
  try {
    return raw ? (JSON.parse(raw) as Catalog) : { buyers: [] };
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
function penalizeBigTiers(tiers?: Tier[], strong = false) {
  if (!tiers || tiers.length === 0) return 0;
  if (tiers.includes("A")) return strong ? -65 : -40;
  if (tiers.includes("B")) return strong ? -25 : -15;
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
 * Apply user preference profile to the scoring based on HTML content and facts.
 * Guardrails:
 *  - cap total preference influence
 *  - require at least 1 organic (non-preference) signal for HOT
 */
function applyPreferences(
  html: string,
  prelimScore: number,
  buyer: BuyerEntry,
  personaSeg: Set<string>,
  personaTags: Set<string>,
  profile?: PrefProfile
) {
  let score = prelimScore;
  const why: string[] = [];

  // No profile → no change
  if (!profile) return { score, why, prefWarm: false, prefHot: false, organicSignal: false };

  const lc = html.toLowerCase();

  // Overlap boosts from profile preferences
  const PREFER_SEG = uniq(profile.preferSegments || []);
  const PREFER_TAG = uniq(profile.preferTags || []);
  const AVOID_SEG  = uniq(profile.avoidSegments || []);
  const AVOID_TAG  = uniq(profile.avoidTags || []);

  if (PREFER_SEG.length && (buyer.segments || []).some(s => PREFER_SEG.includes(norm(s)))) {
    score += 10; why.push("prefer segment");
  }
  if (PREFER_TAG.length && (buyer.tags || []).some(t => PREFER_TAG.includes(norm(t)))) {
    score += 8;  why.push("prefer tag");
  }
  if (AVOID_SEG.length && (buyer.segments || []).some(s => AVOID_SEG.includes(norm(s)))) {
    score -= 12; why.push("avoid segment");
  }
  if (AVOID_TAG.length && (buyer.tags || []).some(t => AVOID_TAG.includes(norm(t)))) {
    score -= 10; why.push("avoid tag");
  }

  // Hot/warm cues scanning
  const HOT_CUES  = uniq(profile.hotCues || []);
  const WARM_CUES = uniq(profile.warmCues || []);

  let prefHot = false;
  let prefWarm = false;

  // mustHave logic (for hot)
  const MUST = uniq(profile.mustHave || []);
  const mustHit = MUST.length ? MUST.some(m => lc.includes(norm(m))) : true;

  // Apply warm cues first
  if (WARM_CUES.length) {
    const hitWarm = WARM_CUES.some(c => lc.includes(c));
    if (hitWarm) { score += 14; prefWarm = true; why.push("user warm cue"); }
  }
  // Apply hot cues
  if (HOT_CUES.length && mustHit) {
    const hitHot = HOT_CUES.some(c => lc.includes(c));
    if (hitHot) { score += 28; prefHot = true; why.push("user hot cue"); }
  }

  // Extra penalty for giants if user asked
  if (profile.excludeGiants) {
    score += penalizeBigTiers(buyer.tiers, true);
  }

  // Guardrail: cap preference influence to ±50
  const delta = score - prelimScore;
  if (delta > 50) score = prelimScore + 50;
  if (delta < -50) score = prelimScore - 50;

  // Organic signal = overlap with supplier persona (not user prefs)
  const organic =
    (buyer.segments || []).some(s => personaSeg.has(norm(s))) ||
    (buyer.tags || []).some(t => personaTags.has(norm(t)));

  return { score, why, prefWarm, prefHot, organicSignal: organic };
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
 *   - city: optional (boost matches); if absent and profile has city, we use profile.city
 *   - minTier: optional ("C" | "B" | "A") default "C"
 *   - limit: optional number (default 12)
 *   - profileId: optional string; if set, we’ll use saved preferences
 */
router.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  const host = norm(req.query.host as string);
  if (!host) {
    return res.status(400).json({ error: "host required", items: [] });
  }

  const minTier = (norm(req.query.minTier as string) as Tier) || "C";
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));

  // profile
  const profileId = norm(req.query.profileId as string);
  const profile = profileId ? PREFS.get(profileId) : undefined;

  // city: explicit query wins; otherwise profile.city
  const cityQ = norm(req.query.city as string);
  const city = cityQ || (profile?.city ? norm(profile.city) : undefined);

  // Persona guess from supplier host keywords
  const persona = guessSupplierPersona(host);
  const personaSeg = new Set(persona.segments.map(norm));
  const personaTags = new Set(persona.tags.map(norm));

  // Stage 1: pre-score from catalog facts (city + tier + static overlaps)
  const prelim = ALL_BUYERS
    .filter(b => tierPass(b.tiers, ["a","b","c"].includes(minTier) ? minTier : "C"))
    .map(b => {
      const base = 50;
      const tierPenalty = penalizeBigTiers(b.tiers, !!profile?.excludeGiants);
      const cBoost = cityBoost(city, b.cityTags);

      // Overlap boosts (organic)
      const segOverlap = (b.segments || []).some(s => personaSeg.has(norm(s))) ? 18 : 0;
      const tagOverlap = (b.tags || []).some(t => personaTags.has(norm(t))) ? 14 : 0;

      const score = base + tierPenalty + cBoost + segOverlap + tagOverlap;

      return { buyer: b, score, why: [] as string[] };
    });

  // Sort high to low and take a wider batch for probing
  prelim.sort((a, b) => b.score - a.score);
  const probeBatch = prelim.slice(0, Math.max(limit * 2, 24));

  // Stage 2: probe pages for warm/hot/smb signals and apply user prefs
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

    // Organic page signals
    const sig = detectSignals(html || "");
    if (sig.smbLikely) { item.score += 25; item.why.push("smb platform"); }
    if (sig.warm)      { item.score += 10; item.why.push("warm"); }
    if (sig.hot)       { item.score += 25; item.why.push("hot"); }

    // Apply user preferences
    const pref = applyPreferences(html || "", item.score, b, personaSeg, personaTags, profile);
    item.score = pref.score;
    item.why.push(...pref.why);

    // Temperature decision with guardrails:
    // - HOT requires either built-in hot OR (user hot & at least one organic signal)
    const isHot =
      (sig.hot && item.score >= 85) ||
      (pref.prefHot && pref.organicSignal && item.score >= 90);

    const isWarm =
      (!isHot && (sig.warm || pref.prefWarm || item.score >= 70));

    const temp: "hot" | "warm" | "cool" = isHot ? "hot" : isWarm ? "warm" : "cool";

    // Compose result row
    const row: ResultItem = {
      host: b.host,
      platform: "web",
      title: b.title || (b.name ? `Suppliers | ${b.name}` : `Suppliers | ${b.host}`),
      created: new Date().toISOString(),
      temp,
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
 * Preferences API (temporary in-memory)
 * - POST /api/prefs/upsert  { id?, city?, hotCues?, warmCues?, mustHave?, preferSegments?, preferTags?, avoidSegments?, avoidTags?, excludeGiants? }
 *   -> returns { ok: true, id, profile }
 * - GET  /api/prefs/:id
 */
router.post("/api/prefs/upsert", (req: Request, res: Response) => {
  const body = (req.body || {}) as Partial<PrefProfile>;
  let id = norm(body.id || "");
  if (!id) {
    // simple deterministic id if none provided
    id = `p-${Math.random().toString(36).slice(2, 10)}`;
  }

  const current = PREFS.get(id) || { id } as PrefProfile;
  const merged: PrefProfile = {
    ...current,
    id,
    city: body.city ?? current.city,
    radiusMi: body.radiusMi ?? current.radiusMi,
    hotCues: body.hotCues ? uniq(body.hotCues) : current.hotCues,
    warmCues: body.warmCues ? uniq(body.warmCues) : current.warmCues,
    mustHave: body.mustHave ? uniq(body.mustHave) : current.mustHave,
    preferSegments: body.preferSegments ? uniq(body.preferSegments) : current.preferSegments,
    preferTags: body.preferTags ? uniq(body.preferTags) : current.preferTags,
    avoidSegments: body.avoidSegments ? uniq(body.avoidSegments) : current.avoidSegments,
    avoidTags: body.avoidTags ? uniq(body.avoidTags) : current.avoidTags,
    excludeGiants: typeof body.excludeGiants === "boolean" ? body.excludeGiants : current.excludeGiants
  };

  // Guardrails on list sizes
  const clamp = (arr?: string[], n = 12) => (arr ? arr.slice(0, n) : arr);
  merged.hotCues = clamp(merged.hotCues, 12);
  merged.warmCues = clamp(merged.warmCues, 12);
  merged.mustHave = clamp(merged.mustHave, 6);
  merged.preferSegments = clamp(merged.preferSegments, 12);
  merged.preferTags = clamp(merged.preferTags, 12);
  merged.avoidSegments = clamp(merged.avoidSegments, 12);
  merged.avoidTags = clamp(merged.avoidTags, 12);

  PREFS.set(id, merged);
  return res.json({ ok: true, id, profile: merged });
});

router.get("/api/prefs/:id", (req: Request, res: Response) => {
  const id = norm(req.params.id);
  const prof = PREFS.get(id);
  if (!prof) return res.status(404).json({ ok: false, error: "not found" });
  return res.json({ ok: true, profile: prof });
});

/**
 * Simple health endpoint so Dockerfile's healthcheck passes quickly.
 */
router.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

export default router;