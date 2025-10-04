// src/shared/geo.ts
//
// Locality / address confidence detector (deterministic; no deps).
// Reads multiple HTML/text pages (e.g., from spider) and extracts:
//  - schema.org PostalAddress (JSON-LD or microdata-ish)
//  - "City, ST 12345" & "City, ST" patterns in visible text
//  - ZIP codes, US state abbreviations, phone area codes (as hints)
//  - Store-locator / Locations surfaces, "Directions" / "Hours" wording
//
// Exports:
//   assessGeo(pages, personaCity?) -> GeoSignal
//   assessPageGeo(page) -> GeoFlags
//   mergeGeoFlags(list) -> GeoFlags
//   brief(signal) -> string
//
// Shapes:
//   type GeoPage = { url: string; html?: string; text?: string }
//   type GeoFlags = {... low-level counters & collections ...}
//   type GeoSignal = {
//     confidence: number; reasons: string[];
//     citiesTop: string[]; statesTop: string[]; zipHints: string[];
//     hasStoreLocator: boolean; flags: GeoFlags
//   }

/* eslint-disable @typescript-eslint/no-explicit-any */

export type GeoPage = { url: string; html?: string; text?: string };

export type PostalAddress = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export type GeoFlags = {
  cities: Map<string, number>;
  states: Map<string, number>;
  zips: Set<string>;
  phoneAreaCodes: Set<string>;

  postalAddresses: PostalAddress[];

  directionsHits: number;
  hoursHits: number;
  visitHits: number;
  storeLocatorHits: number; // words or URLs

  hasAnyAddressSurface: boolean;
};

export type GeoSignal = {
  confidence: number;              // 0..100
  reasons: string[];
  citiesTop: string[];
  statesTop: string[];
  zipHints: string[];
  hasStoreLocator: boolean;
  flags: GeoFlags;
};

const lc = (s: any) => String(s ?? "").toLowerCase();
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function safeText(html?: string, text?: string): string {
  if (text) return String(text);
  const h = String(html || "");
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------ regexes -------------------------------- */

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD",
  "ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD",
  "TN","TX","UT","VA","VT","WA","WI","WV","WY"
];

const RE_CITY_ST_ZIP = new RegExp(
  String.raw`([A-Za-z][A-Za-z\.\- ]{2,}),\s*(${US_STATES.join("|")})\s*(\d{5})(?:-\d{4})?`,
  "g"
);

const RE_CITY_ST = new RegExp(
  String.raw`([A-Za-z][A-Za-z\.\- ]{2,}),\s*(${US_STATES.join("|")})(?![\dA-Za-z])`,
  "g"
);

// plain ZIPs (as hints)
const RE_ZIP = /\b(\d{5})(?:-\d{4})?\b/g;

// simple US phone; capture area code
const RE_PHONE = /(?:\+1[\s\-\.]?)?\(?([2-9]\d{2})\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b/g;

// surfaces
const RE_DIRECTIONS = /\b(get\s+directions|directions|map|google\s+maps)\b/i;
const RE_HOURS      = /\b(hours|opening\s+hours|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
const RE_VISIT      = /\b(visit\s+us|our\s+location|headquarters|hq|warehouse|office)\b/i;

const RE_LOCATOR_WORDS = /\b(store\s+locator|locations|find\s+a\s+store|find\s+us)\b/i;
const RE_LOCATOR_URL   = /(\/(locations|store\-locator|stores|our\-locations)(\/|$))/i;

const RE_JSONLD_SCRIPT = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/* ------------------------ JSON-LD PostalAddress ------------------------ */

function flattenGraph(x: any): any[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.flatMap(flattenGraph);
  const g = (x as any)['@graph'];
  return g ? flattenGraph(g) : [x];
}

function asPostal(obj: any): PostalAddress | null {
  if (!obj) return null;
  const type = obj['@type'];
  const isPostal =
    (typeof type === "string" && /postaladdress/i.test(type)) ||
    (Array.isArray(type) && type.some((t) => /postaladdress/i.test(String(t))));
  if (!isPostal) return null;
  const pa: PostalAddress = {
    street: obj.streetAddress ? String(obj.streetAddress) : undefined,
    city: obj.addressLocality ? String(obj.addressLocality) : undefined,
    state: obj.addressRegion ? String(obj.addressRegion).toUpperCase() : undefined,
    postalCode: obj.postalCode ? String(obj.postalCode) : undefined,
    country: obj.addressCountry ? String(obj.addressCountry) : undefined,
  };
  // clean
  if (pa.state && !US_STATES.includes(pa.state)) {
    // keep non-US states as-is (no normalization)
  }
  if (!pa.street && !pa.city && !pa.state && !pa.postalCode && !pa.country) return null;
  return pa;
}

function extractPostalFromHtml(html?: string): PostalAddress[] {
  if (!html) return [];
  const out: PostalAddress[] = [];
  const scripts = html.match(RE_JSONLD_SCRIPT) || [];
  for (const s of scripts) {
    const body = (s.match(/>([\s\S]*?)<\/script>/i)?.[1] || "").trim();
    try {
      const j = JSON.parse(body);
      const items = flattenGraph(j);
      for (const it of items) {
        // Direct PostalAddress
        const pa = asPostal(it);
        if (pa) out.push(pa);
        // Organization.address -> PostalAddress
        const addr = (it && it.address) ? it.address : null;
        if (addr) {
          const pa2 = asPostal(addr);
          if (pa2) out.push(pa2);
        }
      }
    } catch {
      // ignore invalid blobs
    }
  }
  return dedupPostal(out).slice(0, 50);
}

function dedupPostal(list: PostalAddress[]): PostalAddress[] {
  const seen = new Set<string>();
  const out: PostalAddress[] = [];
  for (const p of list) {
    const k = JSON.stringify({
      s: (p.street || "").toLowerCase(),
      c: (p.city || "").toLowerCase(),
      r: (p.state || "").toLowerCase(),
      z: (p.postalCode || "").toLowerCase(),
      n: (p.country || "").toLowerCase(),
    });
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

/* ------------------------------ per page ------------------------------- */

export function assessPageGeo(page: GeoPage): GeoFlags {
  const url = lc(page.url || "");
  const html = String(page.html || "");
  const text = safeText(page.html, page.text);
  const blob = html + "\n" + text;

  const cities = new Map<string, number>();
  const states = new Map<string, number>();
  const zips = new Set<string>();
  const codes = new Set<string>();

  // city, state, ZIP triplets
  let m: RegExpExecArray | null;
  const rx1 = new RegExp(RE_CITY_ST_ZIP.source, "g");
  while ((m = rx1.exec(text))) {
    const city = m[1].trim().toLowerCase();
    const st = m[2].toUpperCase();
    const zip = m[3];
    bump(cities, city);
    bump(states, st);
    zips.add(zip);
  }

  // city, state pairs
  const rx2 = new RegExp(RE_CITY_ST.source, "g");
  while ((m = rx2.exec(text))) {
    const city = m[1].trim().toLowerCase();
    const st = m[2].toUpperCase();
    bump(cities, city);
    bump(states, st);
  }

  // loose ZIPs
  const rxZ = new RegExp(RE_ZIP.source, "g");
  while ((m = rxZ.exec(text))) {
    zips.add(m[1]);
  }

  // phone area codes
  const rxP = new RegExp(RE_PHONE.source, "g");
  while ((m = rxP.exec(text))) {
    codes.add(m[1]);
  }

  // surfaces
  const directionsHits = countMatches(RE_DIRECTIONS, blob);
  const hoursHits      = countMatches(RE_HOURS, blob);
  const visitHits      = countMatches(RE_VISIT, blob);

  const storeLocatorHits =
    (RE_LOCATOR_WORDS.test(blob) ? 1 : 0) +
    (RE_LOCATOR_URL.test(url) ? 1 : 0) +
    (RE_LOCATOR_URL.test(blob) ? 1 : 0);

  const postalAddresses = extractPostalFromHtml(html);

  const hasAnyAddressSurface =
    postalAddresses.length > 0 ||
    cities.size > 0 ||
    zips.size > 0 ||
    directionsHits > 0 ||
    hoursHits > 0 ||
    visitHits > 0 ||
    storeLocatorHits > 0;

  return {
    cities,
    states,
    zips,
    phoneAreaCodes: codes,
    postalAddresses,
    directionsHits,
    hoursHits,
    visitHits,
    storeLocatorHits,
    hasAnyAddressSurface,
  };
}

function bump(map: Map<string, number>, key: string, n = 1) {
  map.set(key, (map.get(key) || 0) + n);
}

function countMatches(re: RegExp, s: string): number {
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const m = s.match(rx);
  return m ? Math.min(m.length, 200) : 0;
}

/* ----------------------------- merge & score --------------------------- */

export function mergeGeoFlags(list: GeoFlags[]): GeoFlags {
  const base: GeoFlags = {
    cities: new Map(),
    states: new Map(),
    zips: new Set(),
    phoneAreaCodes: new Set(),
    postalAddresses: [],
    directionsHits: 0,
    hoursHits: 0,
    visitHits: 0,
    storeLocatorHits: 0,
    hasAnyAddressSurface: false,
  };
  for (const f of list) {
    f.cities.forEach((v, k) => bump(base.cities, k, v));
    f.states.forEach((v, k) => bump(base.states, k, v));
    f.zips.forEach((z) => base.zips.add(z));
    f.phoneAreaCodes.forEach((c) => base.phoneAreaCodes.add(c));
    base.postalAddresses.push(...f.postalAddresses);
    base.directionsHits += f.directionsHits;
    base.hoursHits += f.hoursHits;
    base.visitHits += f.visitHits;
    base.storeLocatorHits += f.storeLocatorHits;
    base.hasAnyAddressSurface ||= f.hasAnyAddressSurface;
  }
  base.postalAddresses = dedupPostal(base.postalAddresses).slice(0, 100);
  return base;
}

function topN(map: Map<string, number>, n: number): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

export function assessGeo(pages: GeoPage[], personaCity?: string): GeoSignal {
  const per = (Array.isArray(pages) ? pages : []).map(assessPageGeo);
  const flags = mergeGeoFlags(per);

  const citiesTop = topN(flags.cities, 6);
  const statesTop = topN(flags.states, 6);
  const zipHints  = Array.from(flags.zips).slice(0, 12);

  let score = 0;
  const reasons: string[] = [];

  // Strong signals
  if (flags.postalAddresses.length) { score += Math.min(40, 10 + flags.postalAddresses.length * 5); reasons.push("schema-postal"); }
  if (flags.storeLocatorHits)       { score += Math.min(10, 5 + 2 * flags.storeLocatorHits); reasons.push("locator"); }

  // Textual locality
  if (citiesTop.length)  { score += Math.min(12, citiesTop.length * 2); reasons.push("cities"); }
  if (statesTop.length)  { score += Math.min(8,  statesTop.length * 1); reasons.push("states"); }
  if (zipHints.length)   { score += Math.min(6,  Math.ceil(zipHints.length / 2)); reasons.push("zips"); }

  // Supportive surfaces
  const surf = (flags.directionsHits > 0 ? 1 : 0) + (flags.hoursHits > 0 ? 1 : 0) + (flags.visitHits > 0 ? 1 : 0);
  if (surf) { score += Math.min(8, 2 * surf); reasons.push("directions/hours/visit"); }

  // Persona-city match bonus
  const want = lc(personaCity || "");
  if (want && citiesTop.includes(want)) { score += 20; reasons.push(`match:${want}`); }
  else if (want && citiesTop.some((c) => c.includes(want) || want.includes(c))) { score += 12; reasons.push(`match~${want}`); }

  // Phone area code seen (tiny hint only)
  if (flags.phoneAreaCodes.size) { score += 2; reasons.push("phone-area"); }

  // If we only had tiny hints, give a micro baseline
  if (score === 0 && flags.hasAnyAddressSurface) { score += 3; reasons.push("address-surface"); }

  score = clamp(score);

  return {
    confidence: score,
    reasons: reasons.slice(0, 12),
    citiesTop,
    statesTop,
    zipHints,
    hasStoreLocator: flags.storeLocatorHits > 0,
    flags,
  };
}

export function brief(g: GeoSignal): string {
  const bits = [
    g.citiesTop.length ? `city:${g.citiesTop[0]}` : "",
    g.statesTop.length ? `st:${g.statesTop.slice(0,2).join("/")}` : "",
    g.zipHints.length  ? `zip:${g.zipHints.slice(0,2).join("/")}` : "",
    g.hasStoreLocator  ? "locator" : "",
  ].filter(Boolean);
  return `geo ${g.confidence} — ${bits.join(", ") || "none"}`;
}

export default {
  assessGeo,
  assessPageGeo,
  mergeGeoFlags,
  brief,
};