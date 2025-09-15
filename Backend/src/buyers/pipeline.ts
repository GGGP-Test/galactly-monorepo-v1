/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pipeline module
 * - Consumes discovery output
 * - Queries 1–2 free/public sources (DuckDuckGo HTML + Kompass listing)
 * - Produces >= 3 candidate leads { company, domain, region }
 * - Upserts each candidate into BleedStore with evidence
 * - Always returns at least demo fallbacks if scraping yields nothing
 */

import { DiscoveryOutput, CandidateSource, Archetype } from "./discovery";

// ---- BleedStore best-effort
let bleedStore: any | null = null;
(function loadBleedStore() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../data/bleed-store");
    bleedStore =
      (mod && (mod.getStore?.() || mod.store || mod.default || mod)) || null;
  } catch {
    bleedStore = null;
  }
})();

function upsertLeadSafe(lead: any) {
  try {
    if (bleedStore && typeof bleedStore.upsertLead === "function") {
      bleedStore.upsertLead(lead);
    } else {
      console.log("[bleed:upsertLead]", JSON.stringify(lead));
    }
  } catch (e) {
    console.warn("[bleed:upsert:error]", (e as Error).message);
  }
}

function evidence(stage: "pipeline", supplier: string, topic: string, detail: any) {
  return {
    at: new Date().toISOString(),
    stage,
    supplier,
    topic,
    detail,
    source: "PIPELINE",
  };
}

function extractDomain(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return u
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./i, "");
  }
}

function textOnly(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string, timeoutMs = 10_000): Promise<string> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "user-agent": "buyers-engine/1.0 (+https://github.com/; Node20)",
        accept: "text/html,*/*",
      } as any,
    } as any);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(to);
  }
}

function buildQueries(archetypes: Archetype[], region?: string): string[] {
  const base = archetypes.map((a) => a.leadQuery).slice(0, 3);
  const withRegion = base.map((q) => `${q} ${region ?? ""}`.trim());
  // Ensure a general packaging query is included
  if (!withRegion.some((q) => /packaging/i.test(q))) {
    withRegion.push(`packaging supplier ${region ?? ""}`.trim());
  }
  return [...new Set(withRegion)].slice(0, 4);
}

async function searchDuckDuckGo(query: string): Promise<{ title: string; url: string }[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, 10_000);
  // Extract generic anchors; filter out duckduckgo result redirectors and non-company domains
  const anchors = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: m[1], text: textOnly(m[2]).slice(0, 120) }))
    .filter((a) => a.href.startsWith("http"))
    .filter((a) => !/duckduckgo\.com|wikipedia\.org|facebook\.com|linkedin\.com|youtube\.com|github\.com/i.test(a.href))
    .slice(0, 25);

  // Deduplicate by domain
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const a of anchors) {
    const d = extractDomain(a.href);
    if (seen.has(d)) continue;
    seen.add(d);
    out.push({ title: a.text || d, url: a.href });
    if (out.length >= 10) break;
  }
  return out;
}

async function scrapeKompass(query: string): Promise<{ title: string; url: string }[]> {
  const url = `https://www.kompass.com/en/searchCompanies/?searchType=SUPPLIER&text=${encodeURIComponent(
    query
  )}`;
  const html = await fetchText(url, 10_000);
  // Kompass listings often have <a class="company-name" href="...">Company</a>
  const anchors =
    [...html.matchAll(/<a[^>]+class="[^"]*company-name[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)] ||
    [...html.matchAll(/<a[^>]+href="(\/en\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of anchors) {
    const href = m[1].startsWith("http")
      ? m[1]
      : `https://www.kompass.com${m[1]}`;
    const title = textOnly(m[2]).slice(0, 120);
    const d = extractDomain(href);
    if (seen.has(d)) continue;
    seen.add(d);
    out.push({ title, url: href });
    if (out.length >= 10) break;
  }
  return out;
}

function scoreLead(title: string, latents: DiscoveryOutput["latents"]): number {
  const t = title.toLowerCase();
  let s = 0.4; // base
  if (/(packaging|corrugated|stretch|tape|shrink|void fill|bubble|foam)/.test(t)) s += 0.2;
  if (/(3pl|fulfillment|warehouse)/.test(t)) s += (latents.IrregularLoadLikelihood ?? 0.2) * 0.4;
  if (/(cold|frozen|temperature)/.test(t)) s += (latents.ColdChainSensitivity ?? 0.2) * 0.4;
  if (/(fragile|electronics|glass|medical)/.test(t)) s += (latents.FragilityRisk ?? 0.2) * 0.3;
  return Math.min(1, s);
}

export type PipelineInput = {
  region?: string;
  radiusMi?: number;
};

export type CandidateLead = {
  company: string;
  domain: string;
  region?: string;
  score: number;
  source: string;
  evidence: any[];
};

export async function runPipeline(
  discovery: DiscoveryOutput,
  input: PipelineInput
): Promise<{ candidates: CandidateLead[] }> {
  const { region } = input || {};
  const queries = buildQueries(discovery.archetypes || [], region);
  const supplier = discovery.supplierDomain;

  const sourcesToUse: CandidateSource[] = discovery.candidateSources.filter((s) =>
    ["DUCKDUCKGO", "KOMPASS"].includes(s.id)
  );

  const all: CandidateLead[] = [];

  for (const q of queries) {
    // DUCKDUCKGO
    if (sourcesToUse.find((s) => s.id === "DUCKDUCKGO")) {
      const ddgResults = await searchDuckDuckGo(q);
      for (const r of ddgResults.slice(0, 5)) {
        const domain = extractDomain(r.url);
        const company = r.title || domain;
        const score = scoreLead(company, discovery.latents);
        const lead: CandidateLead = {
          company,
          domain,
          region,
          score,
          source: "DUCKDUCKGO",
          evidence: [
            {
              at: new Date().toISOString(),
              stage: "pipeline",
              supplier,
              topic: "found",
              detail: { query: q, title: r.title, url: r.url },
              source: "DUCKDUCKGO",
            },
          ],
        };
        all.push(lead);
        upsertLeadSafe({
          id: `${domain}|DUCKDUCKGO`,
          ...lead,
        });
      }
    }

    // KOMPASS
    if (sourcesToUse.find((s) => s.id === "KOMPASS")) {
      try {
        const list = await scrapeKompass(q);
        for (const r of list.slice(0, 5)) {
          const domain = extractDomain(r.url);
          const company = r.title || domain;
          const score = scoreLead(company, discovery.latents) * 0.95; // slightly conservative
          const lead: CandidateLead = {
            company,
            domain,
            region,
            score,
            source: "KOMPASS",
            evidence: [
              {
                at: new Date().toISOString(),
                stage: "pipeline",
                supplier,
                topic: "found",
                detail: { query: q, title: r.title, url: r.url },
                source: "KOMPASS",
              },
            ],
          };
          all.push(lead);
          upsertLeadSafe({
            id: `${domain}|KOMPASS`,
            ...lead,
          });
        }
      } catch (e) {
        // Non-fatal
        upsertLeadSafe({
          id: `KOMPASS_ERROR|${Date.now()}`,
          company: "KOMPASS_ERROR",
          domain: "kompass.com",
          region,
          score: 0,
          source: "KOMPASS",
          evidence: [
            evidence("pipeline", supplier, "source_error", {
              source: "KOMPASS",
              message: (e as Error).message,
              query: q,
            }),
          ],
        });
      }
    }
  }

  // Dedup by domain; keep best score
  const byDomain = new Map<string, CandidateLead>();
  for (const c of all) {
    const prev = byDomain.get(c.domain);
    if (!prev || c.score > prev.score) byDomain.set(c.domain, c);
  }
  let candidates = [...byDomain.values()];

  // Fallbacks to ensure >=3
  if (candidates.length < 3) {
    const demoBase = [
      { company: "Demo Packaging Co.", domain: "demo-packaging.example" },
      { company: "Sample Corrugated Ltd.", domain: "sample-corrugated.example" },
      { company: "Example Cold Chain Pack", domain: "example-coldpack.example" },
    ];
    for (const d of demoBase) {
      candidates.push({
        company: d.company,
        domain: d.domain,
        region,
        score: 0.42,
        source: "DEMO_SOURCE",
        evidence: [
          evidence("pipeline", supplier, "demo_fallback", {
            reason: "Insufficient results; providing demo candidate.",
          }),
        ],
      });
      upsertLeadSafe({
        id: `${d.domain}|DEMO`,
        company: d.company,
        domain: d.domain,
        region,
        score: 0.42,
        source: "DEMO_SOURCE",
        evidence: [
          evidence("pipeline", supplier, "demo_fallback", {
            reason: "Insufficient results; providing demo candidate.",
          }),
        ],
      });
      if (candidates.length >= 3) break;
    }
  }

  // Trim to reasonable size for MVP
  candidates = candidates.slice(0, 12);

  return { candidates };
}

export default runPipeline;
