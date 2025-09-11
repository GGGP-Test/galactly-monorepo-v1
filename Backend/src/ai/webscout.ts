// src/ai/webscout.ts
// v0: heuristic "web scout" that turns a supplier domain + optional persona
// into likely buyer candidates, ranking by simple, explainable signals.
// No network calls here. You can later swap internals to real scrapers/LLMs.

import fs from "fs/promises";
import path from "path";

export type ScoreChip = {
  label: string;
  score: number;
  detail?: string;
};

export type WhyEvidence = {
  meta?: ScoreChip;      // domain quality
  platform?: ScoreChip;  // platform fit
  signal?: ScoreChip;    // intent keywords
  context?: ScoreChip;   // recent/product/news context
};

export type Candidate = {
  host: string;
  platform: string;
  title: string;
  created: string;
  temperature: "hot" | "warm";
  why: WhyEvidence;
  whyText?: string;
};

export type Persona = {
  offer?: string;
  solves?: string;
  titles?: string; // comma-separated
};

export type FindBuyersInput = {
  supplier: string;          // supplier domain
  region?: "us" | "ca" | "usca";
  radiusMi?: number;
  persona?: Persona;
  onlyUSCA?: boolean;
  seedFilePath?: string;     // optional override
};

export type FindBuyersOutput = {
  ok: true;
  supplierDomain: string;
  created: number;
  ids: number[];
  candidates: Candidate[];
};

const DEFAULT_SEEDS = process.env.SEED_PATH
  || "/etc/secrets/seeds.txt"; // keep your existing convention

const HOT_WORDS = [
  "rfp","rfq","request for quote","request a quote",
  "tender","bid","bidding","solicitation",
];

const PACKAGING_WORDS = [
  "packaging","ship","shipping","fulfillment","3pl","warehouse","pallet",
  "film","wrap","label","mailer","carton","box","bottle","pouch","sleeve",
  "inserts","void fill","corrugate","dunnage",
];

const US_CA_TLDS = [".com",".us",".ca",".org",".net"];

function scoreMeta(host: string): ScoreChip {
  let s = 0.50;
  const tld = host.replace(/^.*\./,'').toLowerCase();
  if (US_CA_TLDS.some(x=>host.endsWith(x))) s += 0.10;
  if (host.split(".").length===2) s += 0.05; // top-level domain (no subdomain)
  return { label:"Domain quality", score: Number(s.toFixed(2)), detail:`${host}` };
}

function scorePlatformFit(platform: string): ScoreChip {
  // v0: unknown => neutral 0.50. (You can wire detectors later.)
  return { label:"Platform fit", score: 0.50, detail: (platform||"unknown") };
}

function hasHotSignal(text: string): boolean {
  const lc = text.toLowerCase();
  return HOT_WORDS.some(w=>lc.includes(w));
}

function countSignals(text: string): number {
  const lc = text.toLowerCase();
  return PACKAGING_WORDS.reduce((n,w)=> n + (lc.includes(w)?1:0), 0);
}

function scoreSignals(text: string): ScoreChip {
  const hot = hasHotSignal(text);
  const hits = countSignals(text);
  let s = 0.55 + Math.min(hits,6) * 0.05; // cap at +0.30
  if (hot) s = Math.max(s, 0.90);
  return {
    label: "Intent keywords",
    score: Number(Math.min(0.99, s).toFixed(2)),
    detail: hot ? "rfp/rfq or tender present" : `${hits} packaging indicators`
  };
}

function toWhyText(host: string, persona?: Persona, sig?: ScoreChip): string {
  const who = host;
  const offer = persona?.offer || "your packaging";
  const solves = persona?.solves || "their shipping/fulfillment needs";
  const hint = sig?.detail ? ` (${sig.detail})` : "";
  return `${who} likely uses ${offer} to address ${solves}${hint}.`;
}

function inferPersonaFromSupplier(supplier: string): Persona {
  const s = supplier.toLowerCase();
  if (s.includes("stretch")) {
    return {
      offer: "stretch film & pallet protection",
      solves: "keeping pallets secure in storage/transport",
      titles: "Warehouse Manager, Purchasing Manager, Operations/COO"
    };
  }
  if (s.includes("label")) {
    return {
      offer: "product & shipping labels",
      solves: "compliance + brand + fulfillment speed",
      titles: "E-com Ops, Packaging Engineer, Purchasing"
    };
  }
  return {
    offer: "packaging supplies",
    solves: "e-com fulfillment & shipping",
    titles: "Ops, Warehouse Manager, Purchasing"
  };
}

async function readSeeds(filePath:string): Promise<string[]>{
  try {
    const buf = await fs.readFile(filePath, "utf8");
    return buf.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeHost(raw: string): string {
  return raw
    .replace(/^https?:\/\//,'')
    .replace(/^www\./,'')
    .replace(/[\/#?].*$/,'')
    .toLowerCase();
}

function regionAllowed(host: string, onlyUSCA: boolean): boolean {
  if (!onlyUSCA) return true;
  // v0 heuristic: prefer common TLDs; you can swap for MaxMind/IP later.
  return US_CA_TLDS.some(tld=>host.endsWith(tld));
}

export async function webScoutFindBuyers(input: FindBuyersInput): Promise<FindBuyersOutput> {
  const supplierDomain = normalizeHost(input.supplier);
  const onlyUSCA = input.onlyUSCA !== false; // default true
  const persona = {
    ...inferPersonaFromSupplier(supplierDomain),
    ...input.persona
  };

  // Load seeds (fast path)
  const seedPath = input.seedFilePath || DEFAULT_SEEDS;
  const lines = await readSeeds(seedPath);

  // Turn seeds into candidate rows — each line can be "host,extra text…"
  type RawRow = { host: string; text: string; platform: string; };
  const rows: RawRow[] = lines.map((line)=> {
    const parts = line.split(/[,\t]/).map(x=>x.trim()).filter(Boolean);
    const host = normalizeHost(parts[0]||"");
    const extra = parts.slice(1).join(", ");
    const platform = (extra.match(/\b(shopify|woocommerce|magento|bigcommerce|etsy|amazon)\b/i)?.[1] || "unknown").toLowerCase();
    return { host, text: extra.toLowerCase(), platform };
  }).filter(r=>r.host);

  // Score + filter
  const now = new Date().toLocaleString();
  const candidates: Candidate[] = [];

  for (const r of rows) {
    if (!regionAllowed(r.host, onlyUSCA)) continue;

    const meta = scoreMeta(r.host);
    const platform = scorePlatformFit(r.platform);
    const signal = scoreSignals(r.text);
    const hot = hasHotSignal(r.text);

    // Keep only plausible buyers (someone who ships/fulfills or mentions packaging markers)
    if (signal.score < 0.60 && !hot) continue;

    const why: WhyEvidence = { meta, platform, signal };
    const whyText = toWhyText(r.host, persona, signal);

    candidates.push({
      host: r.host,
      platform: r.platform || "unknown",
      title: `Lead: ${r.host}`,
      created: now,
      temperature: hot ? "hot" : "warm",
      why,
      whyText
    });
  }

  // De-dup & cap (you can adjust)
  const seen = new Set<string>();
  const unique = candidates.filter(c=> (seen.has(c.host)?false:(seen.add(c.host),true))).slice(0,250);

  return {
    ok: true,
    supplierDomain,
    created: unique.length,
    ids: [], // filled by the route that persists them
    candidates: unique
  };
}

// default export for convenience
export default { webScoutFindBuyers };
