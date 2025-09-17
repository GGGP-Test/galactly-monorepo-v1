import { load as loadHtml } from "cheerio";

export type Persona = {
  supplierDomain: string;
  oneLiner: string;              // "Peak Packaging sells X to Y; best contact: Z"
  offer: string[];               // products/services
  solves: string[];              // problems solved
  buyerTitles: string[];         // who to talk to
  sectors: string[];             // verticals
  confidence: number;            // 0..1
};

const OFFER_HINTS = [
  "packaging", "corrugated", "boxes", "carton", "mailer", "poly mailer", "film",
  "stretch", "wrap", "void fill", "dunnage", "labels", "tape", "strapping",
  "kitting", "3pl", "fulfillment", "right-size", "cartonization", "ista-6"
];

const SOLVE_HINTS = [
  "reduce damage", "reduce returns", "cut dim weight", "dim weight",
  "sustainability", "eco", "recyclable", "save freight", "automation",
  "cartonization", "right size", "right-size", "void reduction", "ISTA-6",
];

const TITLE_HINTS = [
  "packaging engineer", "fulfillment", "supply chain", "operations",
  "procurement", "purchasing", "logistics", "warehouse", "vp operations",
  "director operations", "sustainability"
];

const SECTOR_HINTS = [
  "dtc", "ecommerce", "retail", "subscription", "3pl", "cold chain",
  "food", "beverage", "beauty", "apparel", "electronics", "health",
];

function anyIncludes(text: string, list: string[]) {
  const t = text.toLowerCase();
  return list.filter(w => t.includes(w));
}

async function fetchHtml(url: string) {
  const res = await fetch(url, { headers: { "user-agent": "persona-crawler" }, redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  return await res.text();
}

function uniqTop(arr: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const a of arr) counts.set(a, (counts.get(a) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, limit);
}

export async function buildPersonaFromSupplier(supplierDomain: string): Promise<Persona> {
  const base = `https://${supplierDomain.replace(/^https?:\/\//, "")}`;
  // try a few obvious pages
  const pages = ["/", "/about", "/solutions", "/products", "/services"];
  const texts: string[] = [];

  for (const p of pages) {
    try {
      const html = await fetchHtml(new URL(p, base).toString());
      const $ = loadHtml(html);
      const t = $("body").text().replace(/\s+/g, " ").trim();
      texts.push(t.slice(0, 200000));
    } catch {}
  }
  const corpus = texts.join(" \n ");

  const offer = uniqTop(anyIncludes(corpus, OFFER_HINTS), 6);
  const solves = uniqTop(anyIncludes(corpus, SOLVE_HINTS), 6);
  const buyerTitles = uniqTop(anyIncludes(corpus, TITLE_HINTS), 6);
  const sectors = uniqTop(anyIncludes(corpus, SECTOR_HINTS), 6);

  // heuristic confidence
  const confidence = Math.min(1, (offer.length + buyerTitles.length + sectors.length) / 12);

  const who = buyerTitles[0] ? buyerTitles[0].replace(/\b\w/g, c => c.toUpperCase()) : "Operations";
  const offerStr = offer.slice(0,2).join(", ") || "packaging solutions";
  const sectorStr = sectors.slice(0,2).join(", ") || "e-commerce & retail";
  const oneLiner =
    `${supplierDomain} sells ${offerStr} to ${sectorStr}; best person to contact is ${who}.`;

  return {
    supplierDomain,
    oneLiner,
    offer, solves, buyerTitles, sectors, confidence
  };
}
