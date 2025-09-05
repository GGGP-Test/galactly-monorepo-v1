// src/ai/crawl/crawl-scheduler.ts

/**
 * CrawlScheduler
 *  - Builds discovery queries from user inputs/playbooks
 *  - Fans out to search providers (free on Free plan; can include paid on Pro)
 *  - Merges/dedupes results, filters by policy (avoid mega suppliers), tags
 *  - Emits CrawlTask items to CrawlWorker with priorities
 */

import { DataGuard } from "../compliance/compliance";
import type { Region } from "../compliance/compliance";
import { CrawlWorker } from "./crawl-worker";
import {
  ISearchProvider,
  SearchQuery,
  SearchResult,
  LeadSeed,
  SeedSource,
  Plan,
  DEFAULT_PLAN_CAPS,
  UserDiscoveryInput,
  CrawlTask,
} from "./types";

type Logger = (msg: string, ctx?: any) => void;

export class CrawlScheduler {
  private providers: ISearchProvider[];
  private guard: DataGuard;
  private worker: CrawlWorker;
  private log: Logger;
  private bannedSuppliers = new Set<string>([
    "uline.com",
    "veritivcorp.com",
    "staples.com",
    "grainger.com",
    "fastenal.com",
    "amazon.com",
  ]);

  constructor(opts: {
    worker: CrawlWorker;
    providers: ISearchProvider[];
    guard: DataGuard;
    logger?: Logger;
  }) {
    this.worker = opts.worker;
    this.providers = opts.providers;
    this.guard = opts.guard;
    this.log = opts.logger ?? (() => {});
  }

  /**
   * High-level entry: given the user's discovery intent, discover candidate leads and
   * schedule crawl tasks for the worker.
   */
  async discoverAndSchedule(input: UserDiscoveryInput, plan: Plan) {
    const caps = DEFAULT_PLAN_CAPS[plan];

    const queries = this.buildQueries(input, plan).slice(0, 50); // keep sane
    this.log("[scheduler] queries", queries);

    const usableProviders = this.providers.filter((p) => plan === "pro" ? true : p.freeTier);
    const results = await this.searchAll(usableProviders, queries, caps.maxParallelSearches);

    const seeds = this.mergeAndFilterSeeds(results, input).slice(0, caps.maxSeedUrls);
    this.log("[scheduler] seeds", { count: seeds.length });

    const tasks = this.seedsToTasks(seeds, plan, input);
    for (const t of tasks) this.worker.enqueue(t);
    this.worker.start();
  }

  // ---------------- Query building ----------------

  private buildQueries(input: UserDiscoveryInput, plan: Plan): SearchQuery[] {
    const regions = (input.geo && input.geo.length ? input.geo : [undefined]) as (Region | undefined)[];
    const focuses = input.focuses?.length ? input.focuses : ["stretch wrap", "custom boxes", "corrugated", "void fill", "tape", "mailers"];
    const intents = [
      `"request a quote"`,
      `"bulk pricing"`,
      `"wholesale"`,
      `"minimum order"`,
      `"moq"`,
      `"supplier"`,
      `"distributor"`,
    ];
    const rfqCombos = cartesian(focuses, intents).map(([f, i]) => `${f} ${i}`);

    const platformHints = (input.preferredChannels?.length ? input.preferredChannels : ["Shopify", "WooCommerce"]).map(p => `"${p}"`);
    const channelCombos = focuses.map((f) => `${f} ${randPick(platformHints)}`);

    const extra = input.extraKeywords?.map(k => k.trim()).filter(Boolean) ?? [];

    const queries: SearchQuery[] = [];

    // Core RFQ/wholesale intent dorks
    for (const r of regions) {
      for (const q of rfqCombos) {
        queries.push({ q: `${q} ${geoString(r)}`.trim(), region: r, tags: ["rfq", "wholesale"] });
      }
    }

    // Ecom storefront hints (buyers using packaging)
    for (const r of regions) {
      for (const c of channelCombos) {
        queries.push({ q: `${c} "packaging" ${geoString(r)}`.trim(), region: r, tags: ["ecom", "packaging"] });
      }
    }

    // Review- & logistics-adjacent surfaces (active commerce ops)
    for (const r of regions) {
      queries.push({ q: `("shipping supplies" OR "warehouse supplies") ${geoString(r)}`, region: r, tags: ["ops"] });
      queries.push({ q: `("fulfillment center" OR "3pl") ${geoString(r)}`, region: r, tags: ["ops"] });
    }

    // User extras
    for (const r of regions) {
      for (const ek of extra) {
        queries.push({ q: `${ek} ${geoString(r)}`.trim(), region: r, tags: ["extra"] });
      }
    }

    // If user supplied their own site, mine competitors via "related:" and "intitle:"
    if (input.website) {
      const host = hostOf(input.website);
      for (const r of regions) {
        queries.push({ q: `related:${host} ${geoString(r)}`.trim(), region: r, tags: ["related"] });
        queries.push({ q: `intitle:"packaging" site:${hostRoot(host)} ${geoString(r)}`.trim(), region: r, tags: ["site"] });
      }
    }

    // Trim duplicates / empties
    const seen = new Set<string>();
    return queries
      .filter((q) => q.q.length > 2)
      .filter((q) => {
        const key = `${q.q}|${q.region ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  // ---------------- Provider fanout ----------------

  private async searchAll(providers: ISearchProvider[], queries: SearchQuery[], parallel: number): Promise<SearchResult[]> {
    // Simple round-robin over providers to distribute load
    const out: SearchResult[] = [];
    const queue = [...queries];

    const workers = new Array(Math.max(1, parallel)).fill(0).map(async (_, idx) => {
      while (queue.length) {
        const q = queue.shift();
        if (!q) break;
        const p = providers[(idx + queue.length) % Math.max(1, providers.length)];
        try {
          const got = await p.search(q);
          for (const r of got) {
            r.source = r.source ?? p.id;
            r.tags = r.tags ?? q.tags;
          }
          out.push(...got);
        } catch (e) {
          this.log("[scheduler] provider error", { provider: p.id, q: q.q, error: String(e) });
        }
        // Gentle pacing
        await sleep(200 + Math.random() * 200);
      }
    });

    await Promise.all(workers);
    return out;
  }

  // ---------------- Seed merge/filter ----------------

  private mergeAndFilterSeeds(results: SearchResult[], input: UserDiscoveryInput): LeadSeed[] {
    const seenHost = new Set<string>();
    const seeds: LeadSeed[] = [];

    const avoidBig = input.avoidMegaSuppliers !== false; // default true
    const banned = new Set<string>([...this.bannedSuppliers, ...(input.bannedCompetitors ?? []).map(hostRoot)]);

    for (const r of results) {
      const host = hostOf(r.url);
      if (!host) continue;

      // Skip duplicates by host
      if (seenHost.has(host)) continue;

      // Avoid obvious mega suppliers as *matches* (we still want big buyers)
      if (avoidBig && banned.has(hostRoot(host))) continue;

      // Skip obvious non-target surfaces
      if (isSocialProfile(r.url) || isPdf(r.url)) continue;

      seenHost.add(host);

      seeds.push({
        source: pickSeedSource(r.tags),
        url: normalizeUrl(r.url),
        score: clamp((r.score ?? 0.5) + (r.tags?.includes("rfq") ? 0.2 : 0), 0, 1),
        tags: r.tags ?? [],
      });
    }

    // Sort by descending seed score
    seeds.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return seeds;
  }

  // ---------------- Convert seeds to crawl tasks ----------------

  private seedsToTasks(seeds: LeadSeed[], plan: Plan, input: UserDiscoveryInput): CrawlTask[] {
    const caps = DEFAULT_PLAN_CAPS[plan];
    const tasks: CrawlTask[] = [];
    for (const s of seeds.slice(0, caps.maxSeedUrls)) {
      const u = tryParseUrl(s.url);
      if (!u) continue;

      const priority =
        (s.score ?? 0.5) * 100 +
        (s.tags?.includes("rfq") ? 20 : 0) +
        (s.tags?.includes("ecom") ? 10 : 0);

      tasks.push({
        url: s.url,
        plan,
        tags: s.tags,
        subjectRegion: guessRegionFromHost(u.hostname),
        priority,
        timeoutMs: plan === "free" ? 10000 : 15000,
        maxBytes: plan === "free" ? caps.maxCrawlBytes : caps.maxCrawlBytes,
        // leave robotsAllowed/termsAllow undefined; DataGuard will assume true or the worker can check if supplied
      });
    }
    return tasks;
  }
}

// ---------------- Helpers ----------------
function cartesian<A, B>(a: A[], b: B[]): [A, B][] {
  const out: [A, B][] = [];
  for (const x of a) for (const y of b) out.push([x, y]);
  return out;
}

function randPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function geoString(r?: Region) {
  if (!r) return "";
  if (typeof r === "string") return r;
  const parts = [r.city, r.state, r.country].filter(Boolean);
  return parts.join(" ");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostRoot(host: string): string {
  return host.replace(/^www\./, "");
}

function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString();
  } catch {
    return u;
  }
}

function tryParseUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function isSocialProfile(u: string) {
  return /(facebook|instagram|pinterest|tiktok|x\.com|twitter)\.com\//i.test(u);
}

function isPdf(u: string) {
  return /\.pdf(\?|$)/i.test(u);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function pickSeedSource(tags?: string[]): SeedSource {
  if (!tags || !tags.length) return "user-keywords";
  if (tags.includes("rfq")) return "user-keywords";
  if (tags.includes("ecom")) return "social";
  if (tags.includes("ops")) return "directories";
  if (tags.includes("related")) return "imports";
  return "user-keywords";
}

function guessRegionFromHost(host: string): Region | undefined {
  // Very light heuristic; real implementation could use TLD maps/IP geo in enrichment
  if (host.endsWith(".ca")) return { country: "Canada" };
  if (host.endsWith(".us")) return { country: "United States" };
  return undefined;
}
