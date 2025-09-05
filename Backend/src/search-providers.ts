/*
  search-providers.ts
  Unified, rate-limited search across multiple engines with normalized results.
  Providers supported:
    - Google Programmable Search Engine (CSE) via REST (requires GOOGLE_CSE_ID + GOOGLE_API_KEY)
    - Bing Web Search v7 (requires BING_API_KEY)
    - Brave Search API (requires BRAVE_API_KEY)
    - Serper.dev (Google SERP proxy; SERPER_API_KEY)
    - Common Crawl Index (free; no key)
  Strategy:
    - free-first mode tries CommonCrawl + Serper (if key present) then Brave (has free dev quotas sometimes), then CSE/Bing.
    - normalize results to {url, title, snippet, source, score}
*/

import { URL } from 'url';
import { setTimeout as delay } from 'timers/promises';
import fetch from 'node-fetch';
import { AuditLog } from './ops/audit-log';
import { nowIso, normalizeDomain, stableHash } from './core/job-utils';
import { DedupeIndex } from './core/dedupe-index';

export interface SearchQuery {
  q: string;
  locale?: string;            // e.g., 'en-US'
  country?: string;           // e.g., 'us'
  freshnessDays?: number;     // limit by recency if supported
  num?: number;               // desired results (normalized cap)
  site?: string;              // restrict to site
  filetype?: string;          // 'pdf', 'html', ...
}

export interface SearchResult {
  url: string;
  title?: string;
  snippet?: string;
  source: 'cse' | 'bing' | 'brave' | 'serper' | 'cc' | 'manual';
  rank?: number;
  score?: number;
}

export interface SearchProvidersOptions {
  namespace?: string;
  freeFirst?: boolean;
  ratePerSec?: number; // global soft limit
}

export class SearchProviders {
  private ns: string;
  private freeFirst: boolean;
  private ratePerSec: number;
  private tokens = 0;
  private lastRefill = Date.now();
  private dedupe: DedupeIndex;

  constructor(opts: SearchProvidersOptions = {}) {
    this.ns = opts.namespace ?? 'default';
    this.freeFirst = opts.freeFirst ?? true;
    this.ratePerSec = opts.ratePerSec ?? 4;
    this.dedupe = new DedupeIndex({ namespace: `search:${this.ns}` });
  }

  async discoverLeads(q: SearchQuery): Promise<SearchResult[]> {
    const plan = this.buildPlan();
    const want = Math.min(q.num ?? 30, 50);
    const acc: SearchResult[] = [];
    const seenUrl = new Set<string>();

    for (const step of plan) {
      const got = await step(q, want - acc.length).catch(() => []);
      for (const r of got) {
        if (seenUrl.has(r.url)) continue;
        seenUrl.add(r.url);
        acc.push(r);
      }
      if (acc.length >= want) break;
    }

    // Lightweight normalization scoring (rank + domain uniqueness)
    const domainSeen = new Set<string>();
    acc.forEach((r, i) => {
      const d = normalizeDomain(r.url);
      const novelty = domainSeen.has(d) ? 0 : 1;
      domainSeen.add(d);
      r.rank = i + 1;
      r.score = (want - i) / want + 0.25 * novelty;
    });

    AuditLog.log('search.discoverLeads', { q, count: acc.length });
    return acc;
  }

  // === individual providers ===

  private async cse(q: SearchQuery, n: number): Promise<SearchResult[]> {
    await this.throttle();
    const key = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CSE_ID;
    if (!key || !cx) return [];
    const params = new URLSearchParams({ key, cx, q: composeQuery(q), num: String(Math.min(n, 10)) });
    if (q.locale) params.set('lr', `lang_${q.locale.split('-')[0]}`);
    const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.items ?? []).map((it: any, idx: number) => ({
      url: it.link,
      title: it.title,
      snippet: it.snippet,
      source: 'cse' as const,
      rank: idx + 1,
    }));
  }

  private async bing(q: SearchQuery, n: number): Promise<SearchResult[]> {
    await this.throttle();
    const key = process.env.BING_API_KEY;
    if (!key) return [];
    const params = new URLSearchParams({
      q: composeQuery(q),
      count: String(Math.min(n, 20)),
      mkt: q.locale ?? 'en-US',
      freshnes: q.freshnessDays ? `${q.freshnessDays}d` : '',
    });
    const res = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params.toString()}`, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const web = data.webPages?.value ?? [];
    return web.map((it: any, idx: number) => ({
      url: it.url,
      title: it.name,
      snippet: it.snippet,
      source: 'bing' as const,
      rank: idx + 1,
    }));
  }

  private async brave(q: SearchQuery, n: number): Promise<SearchResult[]> {
    await this.throttle();
    const key = process.env.BRAVE_API_KEY;
    if (!key) return [];
    const params = new URLSearchParams({
      q: composeQuery(q),
      count: String(Math.min(n, 20)),
      locale: q.locale ?? 'en_US',
      country: (q.country ?? 'us').toUpperCase(),
      freshness: q.freshnessDays ? `${q.freshnessDays}d` : 'all',
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      headers: { 'X-Subscription-Token': key },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const web = data.web?.results ?? [];
    return web.map((it: any, idx: number) => ({
      url: it.url,
      title: it.title,
      snippet: it.description,
      source: 'brave' as const,
      rank: idx + 1,
    }));
  }

  private async serper(q: SearchQuery, n: number): Promise<SearchResult[]> {
    await this.throttle();
    const key = process.env.SERPER_API_KEY;
    if (!key) return [];
    const body: any = { q: composeQuery(q), gl: q.country ?? 'us', hl: (q.locale ?? 'en').split('-')[0], num: Math.min(n, 20) };
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const web = data.organic ?? [];
    return web.map((it: any, idx: number) => ({
      url: it.link,
      title: it.title,
      snippet: it.snippet,
      source: 'serper' as const,
      rank: idx + 1,
    }));
  }

  private async commonCrawl(q: SearchQuery, n: number): Promise<SearchResult[]> {
    await this.throttle();
    // CC index query via index.commoncrawl.org (CDX API). Very basic domain pattern support.
    const term = composeQuery(q);
    const site = q.site ? normalizeDomain(q.site) : '';
    const url = `https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=${encodeURIComponent(site ? `*.${site}/*` : `*${term.replace(/\s+/g, '*')}*`)}&output=json&limit=${Math.min(
      n,
      50,
    )}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const txt = await res.text();
    const lines = txt.split('\n').filter(Boolean).slice(0, n);
    const out: SearchResult[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        const u = `http://${rec.url}`; // cdx returns host/path
        const key = normalizeDomain(u) + rec.digest;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: u, title: rec.url, snippet: `cc:${rec.timestamp}`, source: 'cc' });
      } catch {
        // ignore
      }
    }
    return out;
  }

  // === plan builder ===

  private buildPlan(): Array<(q: SearchQuery, n: number) => Promise<SearchResult[]>> {
    const plan: Array<(q: SearchQuery, n: number) => Promise<SearchResult[]>> = [];
    if (this.freeFirst) {
      plan.push(this.commonCrawl.bind(this));
      plan.push(this.serper.bind(this));  // low-cost/free-tier friendly
      plan.push(this.brave.bind(this));
      plan.push(this.cse.bind(this));
      plan.push(this.bing.bind(this));
    } else {
      plan.push(this.cse.bind(this));
      plan.push(this.bing.bind(this));
      plan.push(this.brave.bind(this));
      plan.push(this.serper.bind(this));
      plan.push(this.commonCrawl.bind(this));
    }
    return plan;
  }

  // === throttle ===
  private async throttle() {
    const cap = this.ratePerSec;
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed >= 1) {
      this.tokens = Math.min(cap, this.tokens + Math.floor(elapsed * cap));
      this.lastRefill = now;
    }
    if (this.tokens <= 0) {
      await delay(250);
      return this.throttle();
    }
    this.tokens--;
  }
}

// === helpers ===

function composeQuery(q: SearchQuery): string {
  const parts = [q.q];
  if (q.site) parts.push(`site:${q.site}`);
  if (q.filetype) parts.push(`filetype:${q.filetype}`);
  if (q.freshnessDays) {
    // Some providers accept 'past X days' as recency operators; we encode textually to bias results.
    parts.push(`"last ${q.freshnessDays} days"`);
  }
  return parts.filter(Boolean).join(' ');
}
