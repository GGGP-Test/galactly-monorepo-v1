// Backend/src/ai/webscout.ts
// WebScout v0: lightweight site scan & persona inference with US/CA geo hints.
// No external APIs; uses fetch with short timeouts.

type Persona = {
  offer: string;          // What the supplier sells
  solves: string;         // The pain it solves
  buyerTitles: string[];  // Target titles
  hqCity?: string;
  hqRegion?: "us" | "ca";
  evidence: string[];     // short human-readable bullets
};

const FETCH_TIMEOUT_MS = 5000;

async function tryFetch(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" as any });
    clearTimeout(t);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 250_000); // cap
  } catch {
    return null;
  }
}

function toURL(hostOrUrl: string): string {
  const trimmed = hostOrUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hasAny(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some(w => t.includes(w.toLowerCase()));
}

function extractUSCA(text: string): { city?: string; region?: "us" | "ca" } {
  const T = text.toLowerCase();
  // very rough US/CA cues
  const states = [
    "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky",
    "la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd",
    "oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc"
  ];
  const provinces = ["ab","bc","mb","nb","nl","ns","nt","nu","on","pe","qc","sk","yt"];
  if (T.includes("united states") || /\busa\b/.test(T) || states.some(s=>RegExp(`\\b${s}\\b`).test(T))) {
    return { region: "us" };
  }
  if (T.includes("canada") || provinces.some(s=>RegExp(`\\b${s}\\b`).test(T))) {
    return { region: "ca" };
  }
  return {};
}

export async function scanSupplier(domain: string): Promise<Persona> {
  const base = toURL(domain);
  const pages = [
    base,
    `${base}/products`,
    `${base}/solutions`,
    `${base}/collections`,
    `${base}/about`,
    `${base}/contact`,
  ];

  const htmls = (await Promise.all(pages.map(tryFetch))).filter(Boolean) as string[];
  const joined = htmls.join("\n").slice(0, 500_000);
  const evidence: string[] = [];

  let offer = "Packaging supplies";
  let solves = "Keeps goods protected and ready for shipment";
  let buyerTitles = ["Purchasing Manager", "Warehouse Manager", "COO"];

  // crude product detection
  if (hasAny(joined, ["stretch wrap","stretch film","pallet wrap","shrink wrap"])) {
    offer = "Stretch film & pallet protection";
    solves = "Keeps pallets secure for storage & transit";
    buyerTitles = ["Warehouse Manager", "Logistics Manager", "Purchasing Manager"];
    evidence.push("Found terms: stretch film / pallet wrap");
  } else if (hasAny(joined, ["corrugated boxes","cartons","mailer","box"])) {
    offer = "Cartons & corrugated packaging";
    solves = "Ships DTC/wholesale orders safely";
    buyerTitles = ["Ecommerce Ops", "Fulfillment Lead", "Procurement"];
    evidence.push("Found terms: corrugated/cartons");
  } else if (hasAny(joined, ["bottle","labels","pouches","blister"])) {
    offer = "Specialty packaging (labels/pouches)";
    solves = "Compliant retail packaging & branding";
    buyerTitles = ["Brand Manager", "Operations", "Procurement"];
    evidence.push("Found terms: labels/pouches");
  }

  // logistics hints → persona confidence
  if (hasAny(joined, ["warehouse","3pl","distribution center","pallet","forklift"])) {
    evidence.push("Has warehousing/logistics language");
  }
  if (hasAny(joined, ["rfp","rfq","tender","bid"])) {
    evidence.push("Mentions RFP/RFQ");
  }

  const geo = extractUSCA(joined);
  if (geo.region) evidence.push(`Site content hints ${geo.region.toUpperCase()}`);

  return {
    offer, solves, buyerTitles,
    hqRegion: geo.region,
    evidence,
  };
}
