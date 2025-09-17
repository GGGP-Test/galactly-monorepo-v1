import { load as loadHtml } from "cheerio";
import PQueue from "p-queue";

export type BuyerCandidate = {
  host: string;
  title: string | null;
  platform: "web";
  temp: "warm" | "hot";
  why: string;
};

type Geo = { lat: number; lon: number; radiusMi: number; };

// ---------- helpers ----------
async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  const res = await fetch(url, { signal: c.signal, headers: { "user-agent": "buyers-crawler" }, redirect: "follow" });
  clearTimeout(t);
  if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
  return await res.text();
}

function toRad(miles: number) { return miles * 1609.34; }

// Geo from supplier contact page (best effort)
async function inferGeoFromContact(baseUrl: string): Promise<Geo | null> {
  const tries = ["/contact", "/contact-us", "/locations"];
  for (const p of tries) {
    try {
      const html = await fetchText(new URL(p, baseUrl).toString());
      const $ = loadHtml(html);
      const body = $("body").text().replace(/\s+/g," ").trim();
      // naive address grab (city, state zip)
      const m = body.match(/\b([A-Z][a-zA-Z]+),?\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV)\b/);
      if (!m) continue;
      const q = encodeURIComponent(`${m[1]}, ${m[2]}, USA`);
      const data = await (await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`)).json() as any[];
      if (data?.[0]) {
        return { lat: Number(data[0].lat), lon: Number(data[0].lon), radiusMi: 50 };
      }
    } catch {}
  }
  return null;
}

type OsmElement = { tags?: Record<string,string>, lat?: number, lon?: number }
type OsmResp = { elements: OsmElement[] };

function overpassPayload(lat:number, lon:number, radiusMeters:number) {
  // Warehouses, factories, distribution centres, big retail, logistics
  const q = `
  [out:json][timeout:25];
  (
    node(around:${radiusMeters},${lat},${lon})["building"~"industrial|warehouse|retail|factory|commercial"];
    node(around:${radiusMeters},${lat},${lon})["industrial"];
    node(around:${radiusMeters},${lat},${lon})["shop"~"supermarket|wholesale|department_store|chemist|convenience|mall"];
    node(around:${radiusMeters},${lat},${lon})["man_made"="works"];
  );
  out tags center 100;`;
  return q;
}

function siteFromTags(tags?: Record<string,string>) {
  if (!tags) return null;
  const site = tags["website"] || tags["contact:website"] || null;
  if (site) {
    try { return new URL(site).origin; } catch { return null; }
  }
  return null;
}

function nameFromTags(tags?: Record<string,string>) {
  return tags?.name || null;
}

// signals -> score
function scoreSignals(html: string) {
  const t = html.toLowerCase();
  let score = 0;
  const why: string[] = [];

  // ad pixels (budget/active marketing)
  if (t.includes("gtag(") || t.includes("adsbygoogle")) { score += 1; why.push("running Google Ads/Analytics"); }
  if (t.includes("fbq(") || t.includes("connect.facebook.net")) { score += 1; why.push("Facebook pixel present"); }
  if (t.includes("linkedin.com/liquid")) { score += 1; why.push("LinkedIn Insight pixel present"); }

  // fulfillment/packaging cues
  if (t.includes("packaging")) { score += 1; why.push("site mentions ‘packaging’"); }
  if (t.includes("fulfillment") || t.includes("3pl")) { score += 1; why.push("fulfillment/3PL cues"); }
  if (t.includes("ista-6") || t.includes("right-size") || t.includes("cartonization")) {
    score += 1; why.push("right-size/cartonization/ISTA cue");
  }

  // time-sensitive: look for recent posts by crude date strings
  const recent = /202[4-5]/.test(t) && /(launch|opening|expanding|new location|grand opening|hiring)/.test(t);
  if (recent) { score += 2; why.push("recent launch/opening/hiring signal"); }

  return { score, why };
}

export async function findBuyerCandidates({
  supplierDomain,
  lat,
  lon,
  radiusMi
}: {
  supplierDomain: string,
  lat?: number,
  lon?: number,
  radiusMi?: number
}): Promise<BuyerCandidate[]> {
  const base = `https://${supplierDomain.replace(/^https?:\/\//, "")}`;

  // Geo: use provided or infer from contact page
  let center: Geo | null = (lat && lon) ? { lat, lon, radiusMi: radiusMi ?? 50 } : null;
  if (!center) center = await inferGeoFromContact(base);
  if (!center) {
    // fallback: USA centroid-ish to return something
    center = { lat: 39.50, lon: -98.35, radiusMi: 50 };
  }

  // Overpass (free, public). Be nice.
  const radiusMeters = Math.min(120000, Math.max(1000, toRad(center.radiusMi)));
  const query = overpassPayload(center.lat, center.lon, radiusMeters);
  const osmr = await (await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query })
  })).json() as OsmResp;

  const sites = (osmr.elements || [])
    .map(e => ({ site: siteFromTags(e.tags), name: nameFromTags(e.tags) }))
    .filter(e => !!e.site) as {site:string, name:string|null}[];

  const queue = new PQueue({ concurrency: 3 });
  const out: BuyerCandidate[] = [];

  for (const { site, name } of sites.slice(0, 60)) {
    queue.add(async () => {
      try {
        const html = await fetchText(site!, 8000);
        const $ = loadHtml(html);
        const title = ($("title").first().text() || name || "").trim() || null;
        const sig = scoreSignals(html);

        const temp = sig.score >= 3 ? "hot" : "warm";
        const why = sig.why.length ? sig.why.join("; ") : `near ${supplierDomain} and likely buyer`;

        out.push({
          host: new URL(site!).host,
          title,
          platform: "web",
          temp,
          why
        });
      } catch { /* ignore this site */ }
    });
  }

  await queue.onIdle();

  // de-dup and cap
  const seen = new Set<string>();
  const dedup = out.filter(c => {
    if (seen.has(c.host)) return false;
    seen.add(c.host);
    return true;
  });

  // prefer hot first
  dedup.sort((a,b) => (a.temp === "hot" ? -1 : 1) - (b.temp === "hot" ? -1 : 1));

  return dedup.slice(0, 40);
}
