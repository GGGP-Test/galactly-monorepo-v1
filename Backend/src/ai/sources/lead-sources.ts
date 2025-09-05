// src/ai/sources/lead-sources.ts
// Lead discovery adapters (free-first, plan-aware) + registry.
// Produces candidate leads from open web & indexes before deeper enrichment.
//
// NOTES
// - Keep adapters side-effect free. They only discover candidates; enrichment/persistence happen elsewhere.
// - Respect provider TOS. Many sites forbid automated scraping; prefer official APIs.
// - Environment keys (optional):
//   BING_V7_KEY, GOOGLE_API_KEY (CSE), HF_API_TOKEN
//
// Types kept lightweight to avoid cross-file coupling. If you already have shared types,
// replace with your imports.

export type Plan = "free" | "pro" | "scale";
export interface OrgCtx { orgId: string; plan: Plan; region?: string; }
export interface LeadQuery {
  // User’s product focus. Drives query composition.
  productKeywords: string[]; // e.g., ["stretch wrap", "poly mailers"]
  // Geography filters (city, state, country). Use simple tokens for web queries.
  geos?: string[];           // e.g., ["New Jersey", "NYC", "USA"]
  // Optional vertical or buyer persona words to bias toward active buyers.
  intentHints?: string[];    // e.g., ["RFQ", "wholesale", "distributor", "3PL", "co-packer"]
  // Min signals we believe indicate packaging usage (ads, ecommerce, shipping).
  usageSignals?: ("ecom"|"ads"|"foodbev"|"beauty"|"coldchain")[];
  // Hard exclusions (brands too large, irrelevant industries, etc.)
  excludeBrands?: string[];  // e.g., ["Uline", "Amazon", "Walmart"]
  // Optional lower/upper bounds (heuristic, not authoritative).
  maxTeamSize?: number;      // we’ll use this as a proxy to exclude mega corps
  language?: string;         // "en" default
}

export interface RawLeadHit {
  title?: string;
  url: string;
  snippet?: string;
  domain?: string;   // derived
  source: string;    // adapter id
  geoHint?: string;
}

export interface LeadSeed {
  domain: string;              // canonical
  name?: string;               // if derivable
  meta?: Record<string, any>;  // lightweight signals (will be used by enrichment)
  origin: { adapter: string; url?: string };
}

export interface LeadSource {
  id: string;
  label: string;
  costTier: "free" | "paid";
  supports(plan: Plan): boolean;
  search(q: LeadQuery, ctx: OrgCtx): AsyncGenerator<RawLeadHit>;
}

function hostname(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function uniq<T>(arr: T[]) { return Array.from(new Set(arr)); }

function looksHuge(snippet = "", title = "", domain = ""): boolean {
  // Lightweight heuristics to filter out mega-suppliers the user doesn't want.
  const bigWords = ["billion", "fortune 500", "nyse", "nasdaq", "enterprise", "global leader"];
  const bigBrands = ["uline", "amazon", "walmart", "fedex", "ups", "alibaba", "grainger"];
  const text = `${title} ${snippet} ${domain}`.toLowerCase();
  if (bigBrands.some(b => text.includes(b))) return true;
  return bigWords.some(w => text.includes(w));
}

function scoreHitRelevance(hit: RawLeadHit, q: LeadQuery): number {
  // Very rough textual overlap scoring.
  const text = `${hit.title ?? ""} ${hit.snippet ?? ""}`.toLowerCase();
  let s = 0;
  for (const k of q.productKeywords) if (text.includes(k.toLowerCase())) s += 2;
  for (const g of q.geos ?? []) if (text.includes(g.toLowerCase())) s += 1.5;
  for (const h of q.intentHints ?? []) if (text.includes(h.toLowerCase())) s += 1;
  // bonus if path hints procurement RFQ etc.
  if (/(rfq|rfi|tenders?|quote|wholesale|distributor|supplier)/i.test(text)) s += 1.5;
  return s;
}

function composeQueries(q: LeadQuery): string[] {
  const base = (q.productKeywords.length ? q.productKeywords : ["packaging"]).slice(0, 3);
  const geos = (q.geos ?? ["US"]).slice(0, 3);
  const intents = (q.intentHints ?? ["wholesale", "distributor", "supplier", "rfq"]).slice(0, 4);

  const combos: string[] = [];
  for (const k of base) for (const g of geos) for (const i of intents) {
    combos.push(`${k} ${i} ${g}`);
  }
  // Add usage signal biases
  const sigBias = (q.usageSignals ?? []).map(s => {
    if (s === "ecom") return "site:shopify.com OR site:bigcommerce.com OR site:woocommerce.com";
    if (s === "ads") return "adwords OR \"advertises\"";
    if (s === "foodbev") return "food brand OR beverage co-packer";
    if (s === "beauty") return "cosmetics brand packaging";
    if (s === "coldchain") return "cold chain packaging";
    return "";
  }).filter(Boolean);

  return uniq([
    ...combos,
    ...base.map(k => `${k} buyer list`),
    ...base.map(k => `${k} distributor directory`),
    ...(sigBias.length ? base.map(k => `${k} ${sigBias.join(" ")}`) : []),
  ]).slice(0, 16);
}

async function* paginate<T>(items: T[], pageSize = 10) {
  for (let i = 0; i < items.length; i += pageSize) {
    yield items.slice(i, i + pageSize);
  }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------- Adapters ----------------------------

// 1) Bing Web Search v7 (has a free tier w/ low daily quota via Azure portal)
export class BingWebSource implements LeadSource {
  id = "bing-web";
  label = "Bing Web Search";
  costTier: "free" | "paid" = "free";
  constructor(private key = process.env.BING_V7_KEY) {}
  supports(plan: Plan) { return !!this.key; }

  async *search(q: LeadQuery, ctx: OrgCtx): AsyncGenerator<RawLeadHit> {
    const queries = composeQueries(q);
    for await (const batch of paginate(queries, 2)) {
      await Promise.all(batch.map(() => sleep(200))); // gentle pacing
      for (const term of batch) {
        const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(term)}&mkt=${(q.language ?? "en").toLowerCase()}-${(ctx.region ?? "US")}`;
        const r = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": this.key! } }).catch(() => null);
        if (!r || !r.ok) continue;
        const j: any = await r.json().catch(() => null);
        const web = j?.webPages?.value ?? [];
        for (const it of web) {
          const h: RawLeadHit = {
            title: it.name,
            url: it.url,
            snippet: it.snippet,
            domain: hostname(it.url),
            source: this.id,
            geoHint: q.geos?.[0],
          };
          // filter out obvious mega brands
          if (looksHuge(h.snippet, h.title, h.domain)) continue;
          // exclude user-defined brands
          if ((q.excludeBrands ?? []).some(b => (h.title ?? "").toLowerCase().includes(b.toLowerCase()) || (h.domain ?? "").includes(b.toLowerCase()))) continue;

          // if maxTeamSize is set, try to downrank obvious enterprises later (we’ll keep for now; scoring handles)
          yield h;
        }
      }
    }
  }
}

// 2) Google Programmable Search (CSE). Free quota ~100/day; then billed.
// Requires GOOGLE_API_KEY and a CSE CX id (env: GOOGLE_CSE_CX). Safer than scraping.
export class GoogleCseSource implements LeadSource {
  id = "google-cse";
  label = "Google CSE";
  costTier: "free" | "paid" = "free";
  constructor(private key = process.env.GOOGLE_API_KEY, private cx = process.env.GOOGLE_CSE_CX) {}
  supports(plan: Plan) { return !!this.key && !!this.cx; }

  async *search(q: LeadQuery, ctx: OrgCtx): AsyncGenerator<RawLeadHit> {
    const queries = composeQueries(q).slice(0, 10);
    for (const term of queries) {
      const url = `https://www.googleapis.com/customsearch/v1?key=${this.key}&cx=${this.cx}&q=${encodeURIComponent(term)}`;
      const r = await fetch(url).catch(() => null);
      if (!r || !r.ok) continue;
      const j: any = await r.json().catch(() => ({}));
      for (const it of j.items ?? []) {
        const h: RawLeadHit = {
          title: it.title,
          url: it.link,
          snippet: it.snippet,
          domain: hostname(it.link),
          source: this.id,
          geoHint: q.geos?.[0],
        };
        if (looksHuge(h.snippet, h.title, h.domain)) continue;
        if ((q.excludeBrands ?? []).some(b => (h.title ?? "").toLowerCase().includes(b.toLowerCase()) || (h.domain ?? "").includes(b.toLowerCase()))) continue;
        yield h;
      }
      await sleep(150);
    }
  }
}

// 3) Common Crawl Index (free). Finds domains mentioning keywords, then we refine later.
// This is noisy but costless; good for discovery breadth.
export class CommonCrawlSource implements LeadSource {
  id = "cc-index";
  label = "Common Crawl Index";
  costTier: "free" | "paid" = "free";
  supports(plan: Plan) { return true; }

  async *search(q: LeadQuery, _ctx: OrgCtx): AsyncGenerator<RawLeadHit> {
    // Choose a recent index. If unknown, query "CC-MAIN-2024-10" then fallback.
    const indexes = ["CC-MAIN-2024-10", "CC-MAIN-2023-50", "CC-MAIN-2023-40"];
    const terms = composeQueries(q).slice(0, 6);
    for (const idx of indexes) {
      for (const t of terms) {
        const qstr = encodeURIComponent(`"${t}"`);
        const url = `https://index.commoncrawl.org/${idx}-index?url=${qstr}&output=json`;
        const r = await fetch(url).catch(() => null);
        if (!r || !r.ok) continue;
        const lines = (await r.text().catch(() => ""))?.split("\n").filter(Boolean) ?? [];
        let count = 0;
        for (const line of lines) {
          if (count++ > 40) break; // cap to avoid floods
          let obj: any; try { obj = JSON.parse(line); } catch { continue; }
          const u = obj?.url ?? obj?.urlkey ?? "";
          const domain = hostname(u);
          if (!domain) continue;
          const snippet = [obj?.mime, obj?.status, obj?.digest].filter(Boolean).join(" ");
          const hit: RawLeadHit = { url: u.startsWith("http") ? u : `http://${domain}`, domain, snippet, source: this.id };
          if (looksHuge(snippet, "", domain)) continue;
          yield hit;
        }
        await sleep(200);
      }
    }
  }
}

// 4) Manual/Seed list source (e.g., from user uploads or internal DB). Always free.
export class SeedListSource implements LeadSource {
  id = "seed-list";
  label = "Seed List";
  costTier: "free" | "paid" = "free";
  constructor(private seeds: Array<{ domain: string; name?: string }> = []) {}
  supports(_plan: Plan) { return this.seeds.length > 0; }
  async *search(_q: LeadQuery, _ctx: OrgCtx): AsyncGenerator<RawLeadHit> {
    for (const s of this.seeds) {
      yield { url: `http://${s.domain}`, domain: s.domain, title: s.name, source: this.id };
    }
  }
}

// 5) (Optional) Google Places (Maps) — paid after free credit. Useful for local distributors.
// You may disable at runtime by not setting the key.
export class GooglePlacesSource implements LeadSource {
  id = "g-places";
  label = "Google Places (optional)";
  costTier: "free" | "paid" = "paid";
  constructor(private key = process.env.GOOGLE_API_KEY) {}
  supports(plan: Plan) { return !!this.key && plan !== "free"; }

  async *search(q: LeadQuery, _ctx: OrgCtx): AsyncGenerator<RawLeadHit> {
    const terms = q.productKeywords.length ? q.productKeywords : ["packaging"];
    const geos = q.geos ?? ["United States"];
    for (const g of geos.slice(0, 2)) {
      for (const t of terms.slice(0, 2)) {
        const text = `${t} distributor ${g}`;
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(text)}&key=${this.key}`;
        const r = await fetch(url).catch(() => null);
        if (!r || !r.ok) continue;
        const j: any = await r.json().catch(() => ({}));
        for (const it of j.results ?? []) {
          const website = it.website || it.business_status || "";
          const dom = it.website ? hostname(it.website) : "";
          const title = it.name;
          const hit: RawLeadHit = {
            title, url: it.website || `https://maps.google.com/?cid=${it.place_id}`,
            snippet: it.formatted_address, domain: dom, source: this.id, geoHint: g
          };
          if (looksHuge("", title ?? "", dom)) continue;
          yield hit;
        }
        await sleep(250);
      }
    }
  }
}

// ---------------------------- Registry & helpers ----------------------------

export interface SourceRegistryOptions {
  include?: string[]; // ids
  exclude?: string[];
  seeds?: Array<{ domain: string; name?: string }>;
}

export class LeadSourceRegistry {
  private sources: LeadSource[];

  constructor(opts: SourceRegistryOptions = {}) {
    const all: LeadSource[] = [
      new SeedListSource(opts.seeds ?? []),
      new BingWebSource(),
      new GoogleCseSource(),
      new CommonCrawlSource(),
      new GooglePlacesSource(),
    ];

    this.sources = all.filter(s => {
      if (opts.include?.length) return opts.include.includes(s.id);
      if (opts.exclude?.length) return !opts.exclude.includes(s.id);
      return true;
    });
  }

  list(ctx: OrgCtx) { return this.sources.filter(s => s.supports(ctx.plan)); }

  async *discover(q: LeadQuery, ctx: OrgCtx): AsyncGenerator<LeadSeed> {
    const usable = this.list(ctx);
    const seen = new Set<string>();

    for (const src of usable) {
      // iterate each adapter’s stream, map to seeds with basic ranking
      const buf: RawLeadHit[] = [];
      for await (const hit of src.search(q, ctx)) {
        if (!hit.domain) continue;
        if (!hit.url.startsWith("http")) continue;

        // duplicate control per domain
        if (seen.has(hit.domain)) continue;
        buf.push(hit);
      }

      // Rank buffer by crude relevance then yield
      buf.sort((a, b) => scoreHitRelevance(b, q) - scoreHitRelevance(a, q));

      // Soft-limit per source to avoid flooding downstream
      for (const hit of buf.slice(0, ctx.plan === "free" ? 25 : 100)) {
        const domain = hit.domain!;
        seen.add(domain);

        // Construct seed
        const seed: LeadSeed = {
          domain,
          name: (hit.title ?? "").split(" | ")[0].slice(0, 80) || undefined,
          meta: {
            source: hit.source,
            geoHint: hit.geoHint,
            url: hit.url,
            snippet: hit.snippet,
            // lightweight “size” heuristic: if looks huge, mark to drop later
            looksHuge: looksHuge(hit.snippet, hit.title, domain),
            relScore: Math.round(scoreHitRelevance(hit, q) * 10) / 10,
          },
          origin: { adapter: hit.source, url: hit.url },
        };
        // final guard: drop huge if user set a maxTeamSize (we cannot guarantee mapping so use heuristic)
        if (q.maxTeamSize && seed.meta?.looksHuge) continue;

        yield seed;
      }
    }
  }
}

// ---------------------------- Convenience API ----------------------------

export interface DiscoverOptions extends SourceRegistryOptions {
  max?: number;
}

export async function discoverLeads(q: LeadQuery, ctx: OrgCtx, opts: DiscoverOptions = {}) {
  const reg = new LeadSourceRegistry(opts);
  const out: LeadSeed[] = [];
  const seen = new Set<string>();

  for await (const s of reg.discover(q, ctx)) {
    if (seen.has(s.domain)) continue;
    out.push(s); seen.add(s.domain);
    if (opts.max && out.length >= opts.max) break;
  }
  return out;
}

// ---------------------------- Example usage ----------------------------
// (Remove or wrap in tests in production)
/*
(async () => {
  const ctx: OrgCtx = { orgId: "org_123", plan: "free", region: "US" };
  const q: LeadQuery = {
    productKeywords: ["stretch wrap", "pallet wrap"],
    geos: ["New Jersey", "NY"],
    intentHints: ["wholesale", "distributor", "rfq"],
    usageSignals: ["ecom"],
    excludeBrands: ["Uline", "Amazon"],
    maxTeamSize: 500, // heuristic filter
  };
  const leads = await discoverLeads(q, ctx, { max: 50 });
  console.log("DISCOVERED", leads.length, leads.slice(0, 5));
})();
*/
