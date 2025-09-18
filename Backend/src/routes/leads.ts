import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import runPipeline from "../buyers/pipeline";

type Temp = "hot" | "warm";

type LeadItem = {
  id: number;
  host: string;
  platform?: string;
  title?: string;
  created: string;
  temperature: Temp;
  why?: any;
  whyText?: string;
  region?: string;
  source?: string;
  score?: number;
};

const router = Router();

/* ------------------------------ in-memory db ------------------------------ */
const STORE: { seq: number; items: LeadItem[] } = { seq: 1, items: [] };

/* ----------------------------- small utilities ---------------------------- */
function asHost(input?: string): string {
  if (!input) return "";
  try {
    if (!/^https?:\/\//i.test(input)) return new URL(`https://${input}`).host;
    return new URL(input).host;
  } catch {
    return input;
  }
}

function clamp(v: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function nowIso() {
  return new Date().toISOString();
}

async function withTimeout<T>(p: Promise<T>, ms = 2500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
     .catch((e) => { clearTimeout(t); reject(e); });
  });
}

/** Try to turn a Google News/aggregator link into the final article host. */
async function resolveArticleHost(link?: string): Promise<string | undefined> {
  if (!link) return undefined;
  try {
    const res = await withTimeout(fetch(link, { redirect: "follow" }), 3500);
    // Node 20 fetch follows redirects; final URL should be article
    const finalUrl = res.url || link;
    const host = new URL(finalUrl).host;
    // Avoid returning google host
    if (/google\./i.test(host)) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

/* -------------------------- relevance / scoring --------------------------- */
/** Positive phrases that imply real ops growth → packaging demand. */
const POSITIVE = [
  /opens? (?:new )?(distribution|fulfillment) center/i,
  /(distribution|fulfillment|logistics) center (?:opens|opening|launched)/i,
  /warehouse (?:expansion|expanded|opens|opening|launch)/i,
  /(adds|installing|expanding) (?:new )?(production|packaging) line/i,
  /invest(?:s|ing) in warehouse/i,
  /builds? (?:new )?warehouse/i,
  /co-?packer|3pl|third[- ]party logistics/i,
  /e-?commerce (?:growth|expansion|fulfillment)/i,
];

/** Packaging-aligned terms to boost if present. */
const PACKAGING_TERMS = [
  /packaging/i, /corrugated/i, /carton/i, /box(?:es)?/i, /labels?/i,
  /pallet/i, /stretch film|shrink wrap/i, /dunnage/i, /void fill/i,
];

/** Clear negatives to toss obvious noise. */
const NEGATIVE = [
  /theatre|broadway/i,
  /undefined/i,
  /earnings|dividend|seeking alpha|stock/i,
  /video game|survivors/i,
  /tax treaty|policy brief/i,
];

function relevanceScore(texts: Array<string | undefined>): number {
  const blob = (texts.filter(Boolean).join(" ") || "").slice(0, 800);

  if (NEGATIVE.some((re) => re.test(blob))) return 0;

  let s = 0;
  if (POSITIVE.some((re) => re.test(blob))) s += 0.55;
  if (PACKAGING_TERMS.some((re) => re.test(blob))) s += 0.25;

  // small extras
  if (/distribution|fulfillment/i.test(blob)) s += 0.1;
  if (/opens|opening|launch/i.test(blob)) s += 0.05;

  return clamp(s, 0, 1);
}

function tempFromScore(score: number): Temp {
  return score >= 0.65 ? "hot" : "warm";
}

/* ------------------------------- api key guard ---------------------------- */
// Only enforce API key on write/mutate routes.
function requireApiKey(req: any, res: any, next: any) {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next(); // no key set → open
  const got = req.header("x-api-key");
  if (got !== need)
    return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
}

/* --------------------------------- reads ---------------------------------- */

router.get("/ping", (_req, res) => {
  res.json({ ok: true, service: "leads", count: STORE.items.length });
});

router.get("/ping-news", (_req, res) => {
  res.json({ ok: true, message: "news ping ok" });
});

// GET /api/v1/leads?temp=hot|warm&region=usca
router.get("/", (req, res) => {
  const temp = String(req.query.temp || "").toLowerCase() as Temp | "";
  const region = String(req.query.region || "").toLowerCase();

  let items = STORE.items.slice().reverse();

  if (temp === "hot" || temp === "warm") {
    items = items.filter((x) => x.temperature === temp);
  }
  if (region) {
    items = items.filter(
      (x) => (x.region || "").toLowerCase() === region || region === "usca"
    );
  }
  if (items.length > 500) items = items.slice(0, 500);

  res.json({ ok: true, items });
});

/* --------------------------------- writes --------------------------------- */

// POST /api/v1/leads/find-buyers  (protected)
router.post("/find-buyers", requireApiKey, async (req, res) => {
  try {
    const body = (req.body || {}) as {
      supplier?: string;
      region?: string; // us | ca | usca
      radiusMi?: number;
      persona?: any;
    };

    if (!body.supplier || body.supplier.trim().length < 3) {
      return res
        .status(400)
        .json({ ok: false, error: "supplier domain is required" });
    }

    const supplier = body.supplier.trim().toLowerCase();
    const region = (body.region || "usca").trim().toLowerCase();
    const radiusMi =
      typeof body.radiusMi === "number" &&
      Number.isFinite(body.radiusMi) &&
      body.radiusMi >= 0
        ? Math.floor(body.radiusMi)
        : 50;
    const persona = body.persona;

    // 1) Discovery (fast; cached per module)
    const discovery = await runDiscovery({ supplier, region, persona });

    // 2) Pipeline
    const { candidates } = await runPipeline(discovery, { region, radiusMi });

    // 3) Normalize + filter for packaging relevance
    const now = nowIso();
    const normalized: LeadItem[] = [];
    const toResolve: Array<{ idx: number; link?: string }> = [];

    (candidates || []).forEach((c: any) => {
      const rawTitle =
        c.title ||
        c.reason ||
        c.whyText ||
        c?.evidence?.[0]?.detail?.title ||
        c?.evidence?.[0]?.topic ||
        "";

      const whyText =
        c.whyText ||
        c.reason ||
        c?.evidence?.[0]?.detail?.title ||
        c?.evidence?.[0]?.topic ||
        "";

      // Relevance score (drop if low)
      const score = relevanceScore([rawTitle, whyText]);
      if (score < 0.25) return;

      // Host: prefer company/real article over google
      let host =
        asHost(c.domain) ||
        asHost(c.host) ||
        (c.website ? asHost(c.website) : "") ||
        "";

      if (!host || /google\./i.test(host)) {
        toResolve.push({ idx: normalized.length, link: c.link });
      }

      normalized.push({
        id: STORE.seq++,
        host: host || "unknown",
        platform: c.platform || "unknown",
        title: rawTitle,
        created: now,
        temperature: tempFromScore(score),
        why: c.why || c.evidence || undefined,
        whyText,
        region,
        source: c.source || "UNKNOWN",
        score,
      });
    });

    // Best-effort resolve article hosts (limit to 6 to keep requests fast)
    for (let i = 0; i < Math.min(6, toResolve.length); i++) {
      const { idx, link } = toResolve[i];
      if (!normalized[idx]) continue;
      try {
        const h = await resolveArticleHost(link);
        if (h) normalized[idx].host = h;
      } catch {
        /* ignore */
      }
    }

    // 4) Persist to in-memory store
    if (normalized.length) STORE.items.push(...normalized);

    // For panel’s summary line
    const mapped = normalized.map((c) => ({
      host: c.host,
      title: c.title,
      temperature: c.temperature,
      whyText: c.whyText,
      why: c.why,
      created: c.created,
      score: c.score,
    }));

    const okReal = mapped.some((x) => x.host && x.host !== "unknown");

    return res.status(200).json({
      ok: true,
      supplier: discovery.supplierDomain,
      persona: persona ?? discovery.persona,
      latents: discovery.latents,
      archetypes: discovery.archetypes,
      candidates: mapped,
      created: mapped.length,
      cached: discovery.cached,
      message: okReal
        ? "Candidates discovered."
        : "ok=true but low-confidence candidates only.",
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "internal error" });
  }
});

export default router;