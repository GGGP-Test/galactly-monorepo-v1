// src/leadgen/seeding/directories.ts
/**
 * directories.ts — lightweight public directory scrapers (best-effort, HTML-only)
 * Heads-up: honor robots.txt & site terms. Use sparingly; cache results.
 *
 * Providers implemented:
 *  - Yelp (query search)
 *  - Thomasnet category pages (industrial packaging)
 *
 * Both extract basic fields: name, url, domain, tags, evidence.
 */

import * as crypto from "node:crypto";

export interface DirectoryEntry {
  name: string;
  url: string;
  domain: string;
  tags?: string[];
  evidence?: string[]; // source URLs or snippets
}

export interface DirectoryProvider {
  id: string;
  search(q: string, region?: string, limit?: number): Promise<DirectoryEntry[]>;
}

export class YelpProvider implements DirectoryProvider {
  id = "yelp";
  constructor(private readonly base = "https://www.yelp.com") {}
  async search(q: string, region = "New+Jersey", limit = 20): Promise<DirectoryEntry[]> {
    // Example: /search?find_desc=packaging&find_loc=New+Jersey
    const url = `${this.base}/search?find_desc=${encodeURIComponent(q)}&find_loc=${region}`;
    const html = await httpGet(url);
    const cards = extractAnchors(html)
      .filter(a => /\/biz\//.test(a.href))
      .slice(0, limit);

    const out: DirectoryEntry[] = [];
    for (const a of cards) {
      const name = a.text || "Unknown";
      const u = absolute(this.base, a.href);
      const dom = getDomain(u);
      out.push({ name, url: u, domain: dom, tags: ["yelp", "local"], evidence: [url] });
    }
    return dedupe(out);
  }
}

export class ThomasnetProvider implements DirectoryProvider {
  id = "thomasnet";
  constructor(private readonly base = "https://www.thomasnet.com") {}
  async search(q: string, region?: string, limit = 30): Promise<DirectoryEntry[]> {
    // Example category: /north-america/packaging-materials-95984407-1.html
    // Fallback to site search
    const url = `${this.base}/search.html?what=${encodeURIComponent(q)}${region ? `&where=${encodeURIComponent(region)}` : ""}`;
    const html = await httpGet(url);
    const anchors = extractAnchors(html)
      .filter(a => /\/company\/\d+/.test(a.href) || /\/profile\//.test(a.href))
      .slice(0, limit);

    const out: DirectoryEntry[] = anchors.map(a => {
      const u = absolute(this.base, a.href);
      const dom = getDomain(u);
      return { name: a.text || dom, url: u, domain: dom, tags: ["thomasnet", "industrial"], evidence: [url] };
    });
    return dedupe(out);
  }
}

// ----------------------- Shared utilities ------------------------

type Anchor = { href: string; text: string };

async function httpGet(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "LeadAI/1.0 (+cache; respectful; minimal)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function extractAnchors(html: string): Anchor[] {
  // Minimal anchor extraction; avoids heavy deps. Not a full HTML parser.
  // Matches <a ... href="...">text</a>
  const anchors: Anchor[] = [];
  const re = /<a\b[^>]*href\s*=\s*"(.*?)"[^>]*>(.*?)<\/a>/gis;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decodeHTML(m[1]);
    const text = stripTags(m[2]).trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    anchors.push({ href, text });
  }
  return anchors;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHTML(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function absolute(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function getDomain(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function dedupe(arr: DirectoryEntry[]): DirectoryEntry[] {
  const seen = new Set<string>();
  const out: DirectoryEntry[] = [];
  for (const x of arr) {
    const k = hash((x.domain || "") + "|" + (x.url || ""));
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function hash(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

// Optional registry

export const Directories = {
  yelp: new YelpProvider(),
  thomasnet: new ThomasnetProvider(),
};

export async function searchDirectories(q: string, region?: string, limit = 20): Promise<DirectoryEntry[]> {
  const providers: DirectoryProvider[] = [Directories.yelp, Directories.thomasnet];
  const chunks = await Promise.all(providers.map(p => p.search(q, region, limit)));
  // Merge + dedupe by domain
  const merged = dedupe(chunks.flat());
  return merged.slice(0, limit);
}
