// Backend/src/buyers/discovery.ts
// Cheap-first supplier discovery + persona builder with controllable phrasing.

export type Evidence = { kind: string; note: string; url?: string; ts: number };

export type Persona = {
  oneLiner: string;
  buyerTitles: string[];
  sectors: string[];
  why: string[];
  confidence: number;
};

export type DiscoveryOutput = {
  supplierDomain: string;
  supplierName: string;
  persona: Persona;
  metrics: Record<string, number>;
  evidence: Evidence[];
  candidateSourceQueries: { q: string; source: "duckduckgo" }[];
};

export type DiscoverOptions = {
  supplier: string;            // domain or URL
  region?: string;             // "US"/"CA"...
  personaInput?: string;       // user's free-text (we weight it 90%)
  personaStyle?: "company" | "you"; // how the one-liner is phrased
};

const NOW = () => Date.now();

// ---------- tiny utils ----------
const stripTags = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const hostOnly = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.replace(/^https?:\/\//, ""); }
};
const normUrl = (u: string) => { try { const x = new URL(/^https?:/.test(u) ? u : "https://" + u); x.hash = ""; return x.toString(); } catch { return u; } };

async function get(url: string, timeoutMs = 12000): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (ArtemisBot/1.0)" },
      redirect: "follow",
      signal: ac.signal as any,
    } as any);
    return await r.text();
  } finally { clearTimeout(t); }
}

function titleFrom(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? stripTags(m[1]) : "";
}
function metaSiteName(html: string): string {
  const m = /property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i.exec(html);
  return m ? m[1].trim() : "";
}
function guessName(html: string, domain: string): string {
  const site = metaSiteName(html) || titleFrom(html);
  if (site && site.length > 3 && !/home\b|welcome\b/i.test(site)) return site.replace(/\s*[-|•].*$/, "").trim();
  const d0 = domain.split(".")[0];
  return d0.charAt(0).toUpperCase() + d0.slice(1);
}

// ---------- heuristics ----------
const OFFER_KEYWORDS: Record<string,string[]> = {
  "corrugated": ["corrugated", "boxes", "cartonization", "right-sizing", "right size"],
  "stretch/shrink film": ["stretch film", "shrink film", "pallet wrap", "turntable", "wrapper"],
  "labels": ["labels", "labeling", "thermal transfer", "printers"],
  "void fill": ["void fill", "air pillows", "dunnage", "foam in place"],
  "tape": ["tape", "case seal", "case sealer"],
  "mailers": ["poly mailer", "bubble mailer", "mailer"],
  "packaging machinery": ["case erector", "cartoner", "wrapping machine", "conveyor"],
};

const SECTOR_KEYWORDS: Record<string,string[]> = {
  "3PL / Fulfillment": ["3pl", "fulfillment", "warehouse", "dc", "distribution center"],
  "E-commerce / DTC": ["ecommerce", "e-commerce", "dtc", "subscription"],
  "Food & Beverage": ["food", "beverage", "fsma", "usda", "fda"],
  "Cold Chain / Pharma": ["cold chain", "pharma", "gmp", "cgmp"],
  "Retail": ["retail", "omni", "store"],
  "Manufacturing": ["manufacturing", "factory", "plant"],
};

const TITLES: Record<string,string[]> = {
  "Warehouse Operations Manager": ["warehouse", "distribution center", "fulfillment", "operations"],
  "Purchasing Manager": ["purchasing", "buying", "procurement", "sourcing"],
  "Packaging Engineer": ["packaging engineer", "packaging engineering"],
  "Supply Chain Manager": ["supply chain", "logistics"],
  "Plant Manager": ["plant", "factory", "manufacturing"],
};

function scoreHits(text: string, words: string[]) {
  const T = text.toLowerCase();
  let s = 0; for (const w of words) { if (T.includes(w.toLowerCase())) s++; }
  return s;
}

function topN<T>(entries: [T, number][], n: number): T[] {
  return entries.sort((a,b)=>b[1]-a[1]).slice(0, n).map(x=>x[0]);
}

// parse user intent  (90% weight)
function parseUserPersona(input: string | undefined) {
  if (!input) return null;
  const t = input.toLowerCase();
  const sectors: string[] = [];
  for (const k of Object.keys(SECTOR_KEYWORDS)) if (scoreHits(t, SECTOR_KEYWORDS[k]) > 0) sectors.push(k);
  const titles: string[] = [];
  for (const k of Object.keys(TITLES)) if (scoreHits(t, TITLES[k]) > 0) titles.push(k);
  let offer = "";
  let offerScore = -1;
  for (const k of Object.keys(OFFER_KEYWORDS)) {
    const s = scoreHits(t, OFFER_KEYWORDS[k]);
    if (s > offerScore) { offerScore = s; offer = k; }
  }
  return { sectors, titles, offer };
}

function composeOneLiner(style: "company"|"you", name: string, offer: string, sectors: string[], titles: string[]) {
  const who = style === "company" ? name : "You";
  const sectorTxt = sectors.length ? sectors[0] : "buyers in your market";
  const titleTxt = titles.length ? titles[0] : "the right decision-maker";
  const offerTxt = offer || "packaging solutions";
  return `${who} sell${style==="you"?"":"s"} ${offerTxt} to ${sectorTxt}; the best person to talk to is ${titleTxt}.`;
}

// ---------- main ----------
export async function discoverSupplier(opts: DiscoverOptions): Promise<DiscoveryOutput> {
  const evidence: Evidence[] = [];
  const baseUrl = normUrl(opts.supplier);
  const domain = hostOnly(baseUrl);

  let html = "", aboutHtml = "";
  try { html = await get(baseUrl); evidence.push({ kind: "fetch", note: "homepage ok", url: baseUrl, ts: NOW() }); }
  catch (e:any) { evidence.push({ kind: "fetch", note: `homepage fail: ${e?.message||e}`, url: baseUrl, ts: NOW() }); }

  for (const path of ["/about", "/company", "/who-we-are"]) {
    try {
      const u = normUrl(`https://${domain}${path}`);
      aboutHtml = await get(u);
      evidence.push({ kind: "fetch", note: `about ok (${path})`, url: u, ts: NOW() });
      break;
    } catch {/* ignore */}
  }

  const text = stripTags(html + "\n" + aboutHtml);
  const name = guessName(html || aboutHtml, domain);

  // offer
  let bestOffer = "packaging";
  let bestScore = -1;
  for (const k of Object.keys(OFFER_KEYWORDS)) {
    const s = scoreHits(text, OFFER_KEYWORDS[k]);
    if (s > bestScore) { bestScore = s; bestOffer = k; }
  }

  // sectors / titles
  const sectorScores: [string, number][] = [];
  for (const k of Object.keys(SECTOR_KEYWORDS)) sectorScores.push([k, scoreHits(text, SECTOR_KEYWORDS[k])]);
  const titleScores: [string, number][] = [];
  for (const k of Object.keys(TITLES)) titleScores.push([k, scoreHits(text, TITLES[k])]);

  let sectors = topN(sectorScores, 2).filter(Boolean);
  let titles  = topN(titleScores, 2).filter(Boolean);

  // blend user input (90%)
  const user = parseUserPersona(opts.personaInput);
  if (user) {
    const blend = <T extends string>(userVals: T[], discVals: T[], take = 2) => {
      const map = new Map<T, number>();
      userVals.forEach(v => map.set(v, (map.get(v)||0) + 0.9));
      discVals.forEach(v => map.set(v, (map.get(v)||0) + 0.1));
      return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,take).map(x=>x[0]);
    };
    if (user.offer) bestOffer = user.offer;
    sectors = blend(user.sectors, sectors);
    titles  = blend(user.titles , titles );
  }

  const why: string[] = [];
  if (bestScore > 0) why.push(`site mentions ${bestOffer}`);
  if (sectors.length)  why.push(`hints: ${sectors.join(", ")}`);
  if (titles.length)   why.push(`buyer roles: ${titles.join(", ")}`);

  const conf = Math.min(0.95, 0.55 + (bestScore>0?0.15:0) + (sectors.length?0.1:0) + (titles.length?0.1:0));

  const metrics = {
    ILL: /irregular|mix sku|variety/i.test(text) ? 0.6 : 0.3,
    RPI: /right[- ]?size|cartonization/i.test(text) ? 0.55 : 0.35,
    DFS: /returns|sustainab|weight/i.test(text) ? 0.3 : 0.15,
    FEI: /fragile|shock|ista/i.test(text) ? 0.35 : 0.2,
    SCP: /recycl|eco|green/i.test(text) ? 0.18 : 0.08,
    CCI: /cold|temperature|pharma|gmp/i.test(text) ? 0.25 : 0.05,
  };

  const oneLiner = composeOneLiner(
    opts.personaStyle ?? "company",
    name,
    bestOffer,
    sectors,
    titles
  );

  const qBase = `${bestOffer} buyer procurement ${opts.region || "US"}`;
  const candidateSourceQueries = [
    { source: "duckduckgo" as const, q: `${sectors[0] || "3PL"} ${qBase}` },
    { source: "duckduckgo" as const, q: `${bestOffer} purchasing contact ${opts.region || "US"}` },
  ];

  return {
    supplierDomain: domain,
    supplierName: name,
    persona: { oneLiner, buyerTitles: titles, sectors, why, confidence: conf },
    metrics,
    evidence,
    candidateSourceQueries
  };
}

export default { discoverSupplier };
