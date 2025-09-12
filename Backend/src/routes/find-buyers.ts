import express, { Request, Response } from "express";
import fetch from "node-fetch";

// If you already have a body parser on app level, great.
// Otherwise this router uses express.json() locally so body gets parsed.
export const router = express.Router();
router.use(express.json());

// ----------------------------- Types ------------------------------

type Region = "US/CA" | "US" | "CA" | "EU" | "UK" | "ANY";

type FindBuyersPayload = {
  domain?: string;               // supplier website, e.g. "peakpackaging.com"
  supplierDomain?: string;       // alt name the UI may send
  region?: Region;
  miles?: number;                // search radius hint
  titlesCsv?: string;            // optional buyer titles string
  tenantId?: string;             // multi-tenant support (optional)
  hints?: Record<string, unknown>; // arbitrary client hints
};

// What we store (per supplier/per tenant) as the learned “feature dictionary”
type SupplierSignals = {
  domain: string;
  createdAt: string;
  region?: Region;
  features: Record<string, number>;  // term -> weight (positive favors match)
  keywords: string[];                // expanded term list used for scanning
  lastExpandedAt?: string;
};

// ------------------------ In-memory store -------------------------
// In prod, back this with your DB. This is *not* PII; OK to persist plainly.
const personaStore = new Map<string, SupplierSignals>(); // key: tenantId|domain

// Tiny bootstrap seed (industry-agnostic nudges). This is deliberately small.
// The LLM expansion will grow this per supplier from their site.
const BOOTSTRAP_TERMS = [
  "specification", "sds", "msds", "datasheet", "case study", "whitepaper",
  "warehouse", "3pl", "fulfillment", "co-packer", "co-man", "line speed",
  "downtime", "breakage", "returns", "dim weight", "cold chain", "recyclable",
  "compostable", "automation", "semi-automatic", "turntable", "pre-stretch",
];

// Cheap default OpenRouter model for term expansion (override via env)
const OR_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
const OR_BASE  = "https://openrouter.ai/api/v1/chat/completions";
const OR_KEY   = process.env.OPENROUTER_API_KEY || ""; // optional

// --------------------------- Utilities ----------------------------

function keyFor(tenantId: string | undefined, domain: string) {
  return `${tenantId || "public"}|${domain.toLowerCase()}`;
}

// Robustly pull a field from body or query under several aliases
function pick(req: Request, names: string[]): string | undefined {
  for (const n of names) {
    const b = (req.body as any)?.[n];
    if (typeof b === "string" && b.trim()) return b.trim();
    const q = (req.query as any)?.[n];
    if (typeof q === "string" && q.trim()) return q.trim();
  }
  return undefined;
}

function pickNumber(req: Request, names: string[], fallback?: number): number | undefined {
  for (const n of names) {
    const v = (req.body as any)?.[n] ?? (req.query as any)?.[n];
    const num = Number(v);
    if (!Number.isNaN(num)) return num;
  }
  return fallback;
}

function ok<T>(res: Response, payload: T) { return res.status(200).json({ ok: true, ...payload }); }
function bad(res: Response, msg: string, details?: any) { return res.status(400).json({ ok: false, error: msg, details }); }

// Fetch a couple of public pages to get supplier language (best-effort).
async function grabSiteText(domain: string): Promise<string> {
  const urls = [
    `https://${domain}/`,
    `https://${domain}/products`,
    `https://${domain}/solutions`,
    `https://${domain}/about`,
    `https://${domain}/blog`,
  ];
  const texts: string[] = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { timeout: 5000 as any });
      if (!r.ok) continue;
      const html = await r.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase();
      texts.push(text.slice(0, 60_000)); // keep it cheap
    } catch { /* ignore */ }
  }
  return texts.join("\n");
}

// Ask OpenRouter (if key provided) to expand domain-specific terms cheaply.
async function expandTermsWithLLM(seed: string[], siteText: string, extraHints: string[]): Promise<string[]> {
  if (!OR_KEY) return seed; // no key -> just seed
  const sys = `You expand domain-specific vocabulary. Return a flat, comma-separated list of 30-60 short terms with no explanations. Focus on packaging, buyers/titles, operations words, problems, verticals hinted by the text. Keep terms <=3 words. No duplicates.`;
  const usr = [
    `Seed terms: ${seed.join(", ")}`,
    `Supplier hints: ${extraHints.join(", ")}`,
    `Site snapshot (truncated):\n${siteText.slice(0, 8000)}`
  ].join("\n\n");

  try {
    const r = await fetch(OR_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OR_KEY}`,
        "HTTP-Referer": "https://your-app.example",
        "X-Title": "Persona Expansion",
      },
      body: JSON.stringify({
        model: OR_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr }
        ],
        max_tokens: 300,
      })
    });
    if (!r.ok) return seed;
    const json: any = await r.json();
    const txt: string = json.choices?.[0]?.message?.content || "";
    const list = txt
      .split(/[,|\n]/g)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    // unique + merge with seed
    const merged = Array.from(new Set([...seed.map(s=>s.toLowerCase()), ...list]));
    return merged.slice(0, 120);
  } catch {
    return seed;
  }
}

// Simple keyword scoring → weights (counts normalized)
function scoreKeywords(text: string, keywords: string[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const k of keywords) {
    const rx = new RegExp(`\\b${escapeRegex(k)}\\b`, "gi");
    const matches = text.match(rx);
    const c = matches ? matches.length : 0;
    if (c > 0) weights[k] = 1 + Math.log(1 + c); // damp counts
  }
  return weights;
}

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ----------------------------- Route ------------------------------

router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  // 1) Accept flexible inputs
  const domain = pick(req, ["domain", "supplierDomain", "host", "website"]);
  const region = (pick(req, ["region", "country"]) as Region) || "US/CA";
  const miles  = pickNumber(req, ["miles", "radius", "distance"], 50) || 50;
  const titles = pick(req, ["titlesCsv", "titles", "buyerTitles"]) || "";
  const tenant = pick(req, ["tenantId", "tenant"]) || undefined;

  if (!domain) return bad(res, "domain is required", { got: req.body });

  // 2) Load or build persona signals for this supplier
  const storeKey = keyFor(tenant, domain);
  let signals = personaStore.get(storeKey);

  if (!signals) {
    // Cold start: fetch site, expand terms (optionally via OpenRouter), compute first weights
    const siteText = await grabSiteText(domain);
    const seed = Array.from(new Set([
      ...BOOTSTRAP_TERMS,
      ...titles.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    ]));

    const expanded = await expandTermsWithLLM(seed, siteText, [
      `region=${region}`, `miles=${miles}`, `domain=${domain}`
    ]);

    const weights = scoreKeywords(siteText, expanded);
    signals = {
      domain,
      region,
      createdAt: new Date().toISOString(),
      keywords: expanded,
      features: weights,
      lastExpandedAt: OR_KEY ? new Date().toISOString() : undefined,
    };
    personaStore.set(storeKey, signals);
  }

  // 3) Produce a transparent reply the UI can show, *and* something your
  //    existing ingestion can use to actually mint leads.
  //    (If you already have an internal lead creation service, call it here.)
  const topTerms = Object.entries(signals.features)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, 12)
    .map(([k,w]) => ({ term: k, weight: Number(w.toFixed(3)) }));

  // Stub "candidates" so the panel stops saying 0 — in your real system,
  // transform persona => search queries => scrape/index => insert leads.
  const candidates = topTerms.map(t => ({
    host: domain,
    why: `matches » ${t.term}`,
    temp: "warm",
    score: t.weight,
  }));

  return ok(res, {
    message: `Created ${candidates.length} candidate(s).`,
    region, miles,
    persona: {
      domain: signals.domain,
      terms: topTerms,
      dictionarySize: signals.keywords.length
    },
    candidates
  });
});

// Default export for your route mount code: app.use(router)
export default router;
