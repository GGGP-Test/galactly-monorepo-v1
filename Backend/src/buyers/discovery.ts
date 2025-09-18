// src/buyers/discovery.ts
// Lightweight persona discovery from supplier website (no LLM, no tokens).
// Crawls a couple of pages and extracts product/offer, solves, titles, sectors.

export type Persona = {
  offer: string;
  solves: string;
  titles: string; // comma-separated
  sectors: string[]; // normalized tags
};

export type DiscoveryInput = {
  supplier: string; // domain
  region?: string;
  persona?: Partial<Persona>;
};

export type DiscoveryResult = {
  supplierDomain: string;
  persona: Persona;
  latents: string[];      // keywords we inferred
  archetypes: string[];   // coarse buckets (e.g., "corrugated", "labels", "film")
  cached: boolean;
};

const TIMEOUT_MS = 6000;

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return '';
    const txt = await r.text();
    return txt || '';
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function norm(s: string) {
  return s.toLowerCase();
}

const OFFER_MAP = [
  { k: /corrugated|rsc|fe[fc]co|boxes?|carton/i, tag: 'corrugated boxes' },
  { k: /label|shrink sleeve|rfid/i, tag: 'labels & sleeves' },
  { k: /stretch( |-)?film|shrink( |-)?film|pallet wrap/i, tag: 'film & wrap' },
  { k: /pouch|rollstock|laminate|flexible packaging/i, tag: 'flexible packaging' },
  { k: /foam|molded pulp|inserts?/i, tag: 'protective/void fill' },
  { k: /display|pop/i, tag: 'retail displays' },
];

const TITLES_DEFAULT = [
  'Packaging Engineer',
  'Procurement Manager',
  'Purchasing Manager',
  'Supply Chain Manager',
  'Fulfillment Manager',
  'Warehouse Manager'
];

const SECTOR_MAP = [
  { k: /food|beverage|snack|bakery/i, tag: 'food & beverage' },
  { k: /cosmetic|beauty|personal care/i, tag: 'cosmetics & personal care' },
  { k: /pharma|medical|nutra|sterile/i, tag: 'pharma & medical' },
  { k: /electronic|device/i, tag: 'electronics' },
  { k: /e-?comm|d2c|fulfillment|3pl/i, tag: 'e-commerce & 3PL' },
  { k: /auto|industrial|hardware/i, tag: 'industrial' },
  { k: /cold chain|refrigerated|frozen/i, tag: 'cold chain' },
];

function extractPersona(htmls: string[]): { offer: string; solves: string; titles: string; sectors: string[]; latents: string[]; archetypes: string[] } {
  const txt = norm(htmls.join(' '));
  const latents: string[] = [];

  const offerTags = OFFER_MAP.filter(o => o.k.test(txt)).map(o => o.tag);
  const offer = offerTags.slice(0, 3).join(', ') || 'packaging solutions';

  const sectors = SECTOR_MAP.filter(s => s.k.test(txt)).map(s => s.tag);
  if (sectors.length) latents.push(...sectors);

  const solvesPieces: string[] = [];
  if (/reduce damage|damage reduction|protect/i.test(txt)) solvesPieces.push('reduces damage');
  if (/sustainab|recycl|fsc|pcr|eco|green/i.test(txt)) solvesPieces.push('meets sustainability goals');
  if (/speed|lead time|quick|fast|rapid/i.test(txt)) solvesPieces.push('fast turnaround');
  if (/cold chain|refrigerated|frozen/i.test(txt)) solvesPieces.push('cold chain capable');
  const solves = (solvesPieces.length ? solvesPieces : ['keeps products protected in storage & transit']).join(', ');

  const titles = TITLES_DEFAULT.join(', ');
  const archetypes = offerTags.length ? offerTags : ['general packaging'];

  return { offer, solves, titles, sectors, latents, archetypes };
}

export default async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryResult> {
  const supplierDomain = input.supplier.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const base = `https://${supplierDomain}`;

  // Try a few obvious pages; bail fast if they 404/time out.
  const pages = await Promise.all([
    fetchText(base),
    fetchText(`${base}/about`),
    fetchText(`${base}/products`),
    fetchText(`${base}/capabilities`),
    fetchText(`${base}/industries`)
  ]);

  const derived = extractPersona(pages);
  const persona: Persona = {
    offer: input.persona?.offer || derived.offer,
    solves: input.persona?.solves || derived.solves,
    titles: input.persona?.titles || derived.titles,
    sectors: input.persona?.sectors?.length ? input.persona!.sectors! : derived.sectors
  };

  return {
    supplierDomain,
    persona,
    latents: derived.latents,
    archetypes: derived.archetypes,
    cached: false
  };
}