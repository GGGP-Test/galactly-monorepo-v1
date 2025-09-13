// src/routes/buyers.ts
import { Router, Request, Response } from "express";

// ---- BLEED store (shared memory) ------------------------------------------
import { MemoryBleedStore, type LeadRecord } from "../data/bleed-store";

// Singleton store (process-wide)
const store = (globalThis as any).__BLEED_STORE__ || new MemoryBleedStore();
(globalThis as any).__BLEED_STORE__ = store;

// ---- helpers ---------------------------------------------------------------
const router = Router();
router.options("/leads/find-buyers", (_req, res) => res.sendStatus(204));

function pick<T = string>(obj: any, keys: string[], map?: (v: any) => T): T | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return map ? map(v) : (v as T);
    }
  }
  return undefined;
}

function normalizeDomain(input?: string) {
  if (!input) return "";
  return String(input)
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function extractDomainFromUrl(url: string) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return normalizeDomain(u.hostname);
  } catch {
    return "";
  }
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

// Very small HTML scraper for DuckDuckGo “html” endpoint.
// NOTE: This avoids any paid API. It’s best-effort and resilient if blocked.
async function ddgSearch(query: string, limit = 20): Promise<string[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    // give it a short fuse; never hang the UI
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`ddg ${r.status}`);
  const html = await r.text();

  // DuckDuckGo html SERP has <a class="result__a" href="https://example.com/..">
  const links: string[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && links.length < limit) {
    links.push(m[1]);
  }
  return links;
}

// Make a couple of packaging-oriented queries that tend to surface buyers.
function buildQueries(supplierDomain: string, region?: string) {
  const r = (region || "US").split("/")[0];
  const core = [
    `warehouse "receiving" packaging ${r}`,
    `3PL "packaging" ${r}`,
    `"distribution center" "packaging supplies" ${r}`,
    `"operations manager" "packaging" ${r}`,
  ];
  // bias toward local by including the supplier city if their domain hints it
  const hint = supplierDomain.split(".")[0];
  if (hint && hint.length > 2) core.push(`"${hint}" packaging buyer`);
  return core;
}

// Upsert minimal lead into BLEED store
async function writeLead(tenantId: string, domain: string, region?: string) {
  const record: Partial<LeadRecord> & { tenantId: string } = {
    tenantId,
    source: "web:ddg",
    domain,
    company: domain.split(".")[0],
    region,
    scores: { intent: 0.4, fit: 0.4, timing: 0.2 }, // neutral baseline; refined later
    signals: { discovered: Date.now() },
    status: "enriched",
  };
  const saved = await store.upsertLead(record);
  return saved;
}

// ---- route  ---------------------------------------------------------------
router.post("/leads/find-buyers", async (req: Request, res: Response) => {
  // 1) accept many aliases so the panel never 400s on naming drift
  const body = req.body ?? {};
  const domainRaw =
    pick<string>(body, ["domain", "host", "supplier", "website", "url", "text"]) ??
    (typeof req.query.domain === "string" ? req.query.domain : undefined);
  const supplier = normalizeDomain(domainRaw);

  const region =
    pick<string>(body, ["region", "country", "geo"], (v) => String(v).trim()) ??
    (typeof req.query.region === "string" ? req.query.region : undefined);

  const radiusMi =
    Number(
      pick<number>(body, ["radiusMi", "radius", "miles"], (v) => Number(v)) ??
        (typeof req.query.radius === "string" ? Number(req.query.radius) : NaN)
    ) || 50;

  if (!supplier) {
    const keys = Object.keys(body ?? {});
    return res.status(400).json({ ok: false, error: "domain is required", receivedKeys: keys });
  }

  const tenantId = req.get("x-api-key") || "anon";

  // 2) discovery (free, best-effort)
  let note = "";
  let candidates: string[] = [];
  try {
    const queries = buildQueries(supplier, region);
    const linkSets = await Promise.allSettled(queries.map((q) => ddgSearch(q, 15)));
    const links = linkSets
      .filter((s): s is PromiseFulfilledResult<string[]> => s.status === "fulfilled")
      .flatMap((s) => s.value);

    const domains = uniq(
      links
        .map(extractDomainFromUrl)
        .filter((d) => d && d !== supplier && !d.endsWith(`.${supplier}`))
    );

    // Heuristic: keep only domains that do not look like social/news and that
    // plausibly buy packaging (warehousing, logistics, fulfillment, dc, 3pl).
    const keepWords = ["warehouse", "3pl", "logistic", "fulfillment", "supply", "distribution", "dc"];
    const skipTlds = ["linkedin.com", "facebook.com", "twitter.com", "youtube.com", "reddit.com"];
    candidates = domains.filter(
      (d) =>
        !skipTlds.includes(d) &&
        keepWords.some((w) => d.includes(w)) // very lightweight filter
    );
    if (candidates.length === 0) {
      // fall back to the first few non-supplier domains
      candidates = domains.slice(0, 5);
    }
  } catch (e: any) {
    note = `discovery_disabled: ${e?.message || "fetch failed"}`;
  }

  // 3) persist so /api/v1/leads can show them on Refresh
  let created = 0;
  for (const dom of candidates.slice(0, 10)) {
    try {
      await writeLead(tenantId, dom, region);
      created++;
    } catch {
      /* ignore single failures */
    }
  }

  return res.status(200).json({
    ok: true,
    supplier: { domain: supplier, region, radiusMi },
    created,
    hot: 0,
    warm: created, // mark as warm until scored by later stages
    candidates,
    note,
    message:
      created > 0
        ? `Created ${created} candidate(s). Hot:0 Warm:${created}. Refresh lists to view.`
        : "Created 0 candidate(s). Hot:0 Warm:0. (Either no matches or discovery was blocked.)",
  });
});

// small ping
router.get("/leads/_buyers-ping", (_req, res) => res.json({ ok: true, where: "buyers" }));

export default router;