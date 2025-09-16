/* Lead pipeline (free-first; Pro-ready)
 *
 * Inputs: discovery output (persona, metrics, candidate queries)
 * Output: ranked lead candidates + evidence
 *
 * Free sources now:
 *   - DuckDuckGo HTML results (no API)
 *   - Company "contact/procurement/purchasing" pages via DDG
 *
 * Pro-ready switch:
 *   Pass {pro:true} to enable paid sources later (Apollo, Clearbit, Google CSE, People Data Labs, etc.).
 */

import crypto from "crypto";
import { Persona, DiscoveryOutput, Evidence } from "./discovery";

// ---------- Types ----------

export type Lead = {
  id: string;
  name: string;        // company or facility
  url: string;         // canonical page
  city?: string;
  state?: string;
  phone?: string;
  emails?: string[];
  tags: string[];
  score: number;       // 0..1
  reason: string;      // short why
  source: string;      // "ddg" | "contact-page" | "fallback"
};

export type PipelineOptions = {
  region?: string;     // "US" | "CA" ...
  pro?: boolean;       // future: enable paid sources
  maxLeads?: number;   // default 10
  timeoutMs?: number;  // default 12_000
};

export type PipelineResult = {
  leads: Lead[];
  evidence: Evidence[];
};

// ---------- Helpers ----------

const now = () => Date.now();

function host(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function normUrl(u: string) {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString();
  } catch { return u; }
}

function ddgUrl(q: string) {
  // HTML results (no JS). Use “kp=1” to prefer US/English layout.
  const params = new URLSearchParams({ q, kl: "us-en", kp: "1" });
  return `https://duckduckgo.com/html/?${params.toString()}`;
}

async function getText(url: string, timeoutMs = 12000): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ArtemisLeadBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: ac.signal as any,
    } as any);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function* parseDdgs(html: string): Generator<{ title: string; url: string; snippet: string }> {
  // Very light parser for /html SERP. We avoid heavy DOM libs to stay small.
  // Result blocks look like: <a class="result__a" href="URL">TITLE</a> ... <a class="result__snippet">...</a>
  const blockRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = blockRe.exec(html))) {
    const url = m[1].replace(/&amp;/g, "&");
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const snippet = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    yield { title, url, snippet };
  }
}

function scoreLead(p: Persona, title: string, snippet: string, url: string): { score: number; tags: string[]; reason: string } {
  const T = (title + " " + snippet + " " + url).toLowerCase();
  const tags: string[] = [];

  const hit = (re: RegExp, tag: string, w: number) => {
    if (re.test(T)) { tags.push(tag); return w; }
    return 0;
  };

  let s = 0;
  s += hit(/\b(procurement|sourcing|purchasing)\b/, "procurement", 0.35);
  s += hit(/\b(packaging)\b/, "packaging", 0.25);
  s += hit(/\b(distribution center|warehouse|3pl)\b/, "ops", 0.2);
  s += hit(/\b(rfq|request for quote)\b/, "rfq", 0.25);
  s += hit(/\b(buyer|category manager)\b/, "buyer", 0.2);

  // align with inferred sectors / titles
  const want = (p.buyerTitles.join(" ") + " " + p.sectors.join(" ")).toLowerCase();
  if (want) {
    const overlap = want.split(/\W+/).filter(k => k && T.includes(k)).length;
    s += Math.min(0.2, overlap * 0.03);
  }

  s = Math.min(1, s);
  const reason = tags.length ? `keywords: ${tags.join(", ")}` : "SERP match";
  return { score: s, tags, reason };
}

function pickName(title: string, url: string): string {
  const h = host(url);
  const domName = h.split(".")[0];
  // Prefer page title words, fallback to domain
  const t = title.replace(/\s*[-|•].*$/, "").trim();
  return t.length >= 4 ? t : domName;
}

function idFor(u: string) {
  return crypto.createHash("md5").update(normUrl(u)).digest("hex").slice(0, 12);
}

function uniqueBy<T>(arr: T[], key: (x: T)=>string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of arr) {
    const k = key(a);
    if (!seen.has(k)) { seen.add(k); out.push(a); }
  }
  return out;
}

function extractEmails(html: string): string[] {
  const set = new Set<string>();
  const re = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
  let m;
  while ((m = re.exec(html))) set.add(m[0].toLowerCase());
  return [...set].slice(0, 5);
}

function maybeRegionFilter(u: string, region?: string): boolean {
  if (!region || region.toUpperCase() === "US") return true;
  // Naive geo filter: allow if url hints region
  const R = region.toLowerCase();
  return new RegExp(`\\b${R}\\b`).test(u.toLowerCase());
}

// ---------- Main pipeline ----------

export async function generateLeads(
  discovery: DiscoveryOutput,
  opts: PipelineOptions = {}
): Promise<PipelineResult> {
  const evidence: Evidence[] = [];
  const maxLeads = opts.maxLeads ?? 10;
  const timeoutMs = opts.timeoutMs ?? 12_000;

  const leads: Lead[] = [];
  const push = (l: Lead) => { if (maybeRegionFilter(l.url, opts.region)) leads.push(l); };

  // 1) Run DDG queries
  for (const q of discovery.candidateSourceQueries) {
    if (q.source !== "duckduckgo") continue;

    const url = ddgUrl(q.q);
    let html = "";
    try {
      html = await getText(url, timeoutMs);
      evidence.push({ kind: "fetch", note: `DDG q="${q.q}" ok`, url, ts: now() });
    } catch (e: any) {
      evidence.push({ kind: "fetch", note: `DDG q="${q.q}" failed: ${e?.message || e}`, url, ts: now() });
      continue;
    }

    for (const r of parseDdgs(html)) {
      const sc = scoreLead(discovery.persona, r.title, r.snippet, r.url);
      if (sc.score < 0.25) continue; // prune weak matches

      push({
        id: idFor(r.url),
        name: pickName(r.title, r.url),
        url: normUrl(r.url),
        tags: sc.tags,
        score: sc.score,
        reason: sc.reason,
        source: "ddg",
      });
    }
  }

  // 2) Try to enrich top host pages with “contact/procurement/purchasing”
  const enrichTargets = uniqueBy(leads, l => host(l.url)).slice(0, 8);
  const enrichQueries = ["contact", "purchasing", "procurement", "supplier", "rfq"];
  for (const t of enrichTargets) {
    const h = host(t.url);
    if (!h) continue;
    for (const k of enrichQueries) {
      const q = `site:${h} (${k}) packaging`;
      const url = ddgUrl(q);
      try {
        const html = await getText(url, timeoutMs);
        for (const r of parseDdgs(html)) {
          const scoreBoost = /contact|rfq|purchas|procure/i.test(r.url) ? 0.2 : 0.1;
          const sc = scoreLead(discovery.persona, r.title, r.snippet, r.url);
          if (sc.score + scoreBoost < 0.35) continue;

          push({
            id: idFor(r.url),
            name: pickName(r.title, r.url),
            url: normUrl(r.url),
            tags: [...new Set([...t.tags, ...sc.tags, "enriched"])],
            score: Math.min(1, Math.max(t.score, sc.score + scoreBoost)),
            reason: "host enrichment",
            source: "contact-page",
          });
        }
      } catch { /* ignore */ }
    }
  }

  // 3) Dedup & rank
  const ranked = uniqueBy(leads, l => l.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLeads);

  // 4) Last-resort fallback so the UI always shows something
  if (ranked.length === 0) {
    const baseQ = `${discovery.persona.sectors[0] || "3PL"} packaging buyer ${opts.region || "US"}`;
    const url = ddgUrl(baseQ);
    evidence.push({ kind: "assumption", note: `fallback query`, url, ts: now() });
    ranked.push({
      id: idFor(url),
      name: "Packaging buyer prospects",
      url,
      tags: ["fallback", "prospect-list"],
      score: 0.3,
      reason: "seed query",
      source: "fallback",
    });
  }

  return { leads: ranked, evidence };
}

export default { generateLeads };
