// src/routes/leads.ts
import { Router } from "express";
import { q } from "../shared/db";

type LeadTemp = "warm" | "hot";
interface LeadItem {
  host: string;
  platform: "web";
  title: string;
  why_text: string;
  created: string;
  temp: LeadTemp;
}

const router = Router();
const ISO = () => new Date().toISOString();

/* -------------------- tiny fetch helpers -------------------- */
async function isReachable(url: string, timeoutMs = 4500): Promise<boolean> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    if (!r.ok || (r.status >= 500 && r.status <= 599)) {
      r = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
    }
    return r.ok;
  } catch {
    return false;
  } finally { clearTimeout(to); }
}
async function fetchText(url: string, timeoutMs = 5000): Promise<string> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "GET", signal: ctrl.signal });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  } finally { clearTimeout(to); }
}

/* -------------------- DB utils -------------------- */
async function ensureLeadsTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      host TEXT NOT NULL,
      platform TEXT NOT NULL,
      title TEXT NOT NULL,
      why_text TEXT NOT NULL,
      temp TEXT NOT NULL,
      created TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS leads_created_idx ON leads(created DESC);
  `);
}
async function saveLeads(items: LeadItem[]) {
  if (!items.length) return;
  try {
    await ensureLeadsTable();
    const values = items.map((_, i) =>
      `($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`).join(",");
    const params = items.flatMap(x => [x.host, x.platform, x.title, x.why_text, x.temp, x.created]);
    await q(`INSERT INTO leads (host,platform,title,why_text,temp,created) VALUES ${values};`, params as any[]);
  } catch { /* non-blocking */ }
}

/* -------------------- vertical inference -------------------- */
type Vertical = "food_bev" | "beauty_personal" | "household" | "pet" | "generic";
function inferVertical(html: string): Vertical {
  const h = html.toLowerCase();
  if (/\b(food|beverage|snack|drink|bottl|can|frozen|grocery|dairy|confection|brew|coffee|tea)\b/.test(h)) return "food_bev";
  if (/\b(cosmetic|beauty|skincare|fragrance|personal care|haircare|soap|shampoo|lotion|makeup)\b/.test(h)) return "beauty_personal";
  if (/\b(cleaning|laundry|detergent|air care|home care|household)\b/.test(h)) return "household";
  if (/\b(pet|cat|dog|treats|kibble|litter)\b/.test(h)) return "pet";
  return "generic";
}
function parseCatsParam(cats: string|undefined): Vertical[]|null {
  if (!cats) return null;
  const set = new Set(
    cats.split(",")
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
  );
  const out: Vertical[] = [];
  if (set.has("food") || set.has("beverage") || set.has("fb")) out.push("food_bev");
  if (set.has("beauty") || set.has("personal") || set.has("cosmetic")) out.push("beauty_personal");
  if (set.has("home") || set.has("household") || set.has("cleaning")) out.push("household");
  if (set.has("pet") || set.has("pets")) out.push("pet");
  return out.length ? out : null;
}

/* -------------------- curated candidates -------------------- */
type RegionTag =
  | "US/National" | "US/West" | "US/East" | "US/Central"
  | "US/CA" | "US/TX" | "US/FL" | "US/NY" | "US/WA" | "US/IL";
interface Cand {
  host: string;
  url: string;
  why: string;
  regions: RegionTag[];
  size: "mega"|"large"|"mid";
  verticals?: Vertical[];
}

const CANDS: Cand[] = [
  // Mid/regional retail (promoted by default)
  { host:"heb.com",               url:"https://www.heb.com/static-page/vendor-portal",                 why:"retail vendor portal", regions:["US/TX","US/Central"], size:"mid",   verticals:["food_bev","pet","household"] },
  { host:"sprouts.com",           url:"https://about.sprouts.com/contact/supplier",                    why:"retail supplier info", regions:["US/West","US/CA"],     size:"mid",   verticals:["food_bev"] },
  { host:"traderjoes.com",        url:"https://www.traderjoes.com/home/contact-us/supplier-relations",why:"supplier relations",   regions:["US/West","US/CA"],    size:"mid",   verticals:["food_bev","beauty_personal","household"] },
  { host:"wincofoods.com",        url:"https://wincofoods.com/about/suppliers",                        why:"supplier info",        regions:["US/West"],             size:"mid",   verticals:["food_bev"] },
  { host:"meijer.com",            url:"https://www.meijer.com/services/suppliers.html",                why:"supplier info",        regions:["US/Central"],          size:"mid",   verticals:["food_bev","household","beauty_personal"] },
  { host:"wegmans.com",           url:"https://www.wegmans.com/about-us/suppliers/",                  why:"supplier info",        regions:["US/East","US/NY"],     size:"mid",   verticals:["food_bev"] },

  // Large retail
  { host:"aldi.us",               url:"https://corporate.aldi.us/en/corporate-responsibility/suppliers/", why:"supplier info",  regions:["US/National"], size:"large", verticals:["food_bev","household"] },
  { host:"kroger.com",            url:"https://www.thekrogerco.com/vendors-suppliers/",                why:"vendor portal",       regions:["US/National"], size:"large", verticals:["food_bev","household","beauty_personal","pet"] },
  { host:"albertsons.com",        url:"https://www.albertsons.com/our-company/doing-business-with-us.html", why:"vendor info",  regions:["US/West","US/National","US/CA"], size:"large", verticals:["food_bev","household","beauty_personal","pet"] },

  // Food/bev brands
  { host:"jmsmucker.com",         url:"https://www.jmsmucker.com/about/suppliers",                     why:"supplier information", regions:["US/National"], size:"large", verticals:["food_bev","pet"] },
  { host:"campbellsoupcompany.com",url:"https://www.campbellsoupcompany.com/about-us/suppliers/",      why:"supplier information", regions:["US/East"],     size:"large", verticals:["food_bev"] },
  { host:"hormelfoods.com",       url:"https://www.hormelfoods.com/about/suppliers/",                  why:"supplier portal",      regions:["US/Central"],  size:"large", verticals:["food_bev"] },
  { host:"keurigdrpepper.com",    url:"https://www.keurigdrpepper.com/en/our-company/suppliers",       why:"supplier information", regions:["US/National"], size:"large", verticals:["food_bev"] },

  // Beauty/personal care
  { host:"elcompanies.com",       url:"https://www.elcompanies.com/en/our-suppliers",                  why:"supplier info",        regions:["US/National"], size:"large", verticals:["beauty_personal"] },
  { host:"edgewell.com",          url:"https://edgewell.com/suppliers/",                               why:"supplier resources",   regions:["US/National"], size:"mid",   verticals:["beauty_personal","household"] },
  { host:"ulta.com",              url:"https://www.ulta.com/company/suppliers",                        why:"supplier info",        regions:["US/National"], size:"large", verticals:["beauty_personal"] },

  // Household
  { host:"churchdwight.com",      url:"https://churchdwight.com/suppliers",                            why:"supplier registration",regions:["US/National"], size:"large", verticals:["household","beauty_personal"] },
  { host:"scjohnson.com",         url:"https://www.scjohnson.com/en/our-company/suppliers",            why:"supplier information", regions:["US/National"], size:"large", verticals:["household"] },
  { host:"thecloroxcompany.com",  url:"https://www.thecloroxcompany.com/partners/suppliers/",          why:"supplier onboarding",  regions:["US/West","US/National","US/CA"], size:"large", verticals:["household","beauty_personal"] },

  // Pet
  { host:"petco.com",             url:"https://www.petco.com/content/petco/about/petco-suppliers.html",why:"vendor / supplier info", regions:["US/West","US/National"], size:"large", verticals:["pet","beauty_personal","household"] },
  { host:"petsmart.com",          url:"https://corporate.petsmart.com/suppliers",                      why:"supplier information",  regions:["US/National"],          size:"large", verticals:["pet"] },
  { host:"chewy.com",             url:"https://www.chewy.com/g/vendor-inquiry",                        why:"vendor inquiry",        regions:["US/East","US/National"], size:"mid",   verticals:["pet"] },
];

const MEGAS = new Set(["walmart.com","amazon.com","pg.com","pepsico.com","cocacolacompany.com","target.com","costco.com"]);

/* -------------------- scoring (region + size + vertical) -------------------- */
type SizePref = "mid" | "large" | "mega" | "all" | "balanced";
function scoreCandidate(
  c: Cand,
  verticalWanted: Vertical[],
  regionHint: string,
  radiusMiles: number,
  sizePref: SizePref
): number {
  let s = 0;

  // vertical affinity
  if (!verticalWanted.length) s += 0;
  else if (c.verticals?.some(v => verticalWanted.includes(v))) s += 3;

  // region weighting (smaller radius -> stronger local boost)
  const baseRegion =
    radiusMiles <= 50 ? 4 :
    radiusMiles <= 150 ? 2 :
    1;

  if (regionHint) {
    if (c.regions.includes(regionHint as any)) s += baseRegion;
    const broad = regionHint.split("/")[1]; // e.g., "CA"
    if (broad && c.regions.some(r => (r as string).endsWith(broad))) s += Math.max(1, baseRegion - 1);
    if (c.regions.includes("US/National")) s += 1;
  }

  // size preference
  const sizeBoost = (sp: SizePref, size: Cand["size"]) => {
    if (sp === "all" || sp === "balanced") return size === "mid" ? 2 : size === "large" ? 1 : -2;
    if (sp === "mid")  return size === "mid"  ? 3 : size === "large" ? 1 : -3;
    if (sp === "large")return size === "large"? 3 : size === "mid"   ? 1 : -2;
    if (sp === "mega") return size === "mega" ? 4 : -1;
    return 0;
  };
  s += sizeBoost(sizePref, c.size);

  // globally demote mega-caps unless explicitly requested
  if (MEGAS.has(c.host)) s -= (sizePref === "mega" ? 0 : 3);

  return s;
}

/* -------------------- build live list -------------------- */
async function liveSweepForBuyers(
  supplierHost: string,
  regionHint: string,
  radiusMiles: number,
  sizePref: SizePref,
  limit: number,
  catsParam?: string
): Promise<LeadItem[]> {

  // infer vertical(s) from supplier site, allow override via cats=
  let verticals: Vertical[] = [];
  const override = parseCatsParam(catsParam);
  if (override) {
    verticals = override;
  } else {
    try {
      const html = await fetchText(`https://${supplierHost}/`);
      const v = inferVertical(html);
      verticals = v === "generic" ? [] : [v];
    } catch {
      verticals = [];
    }
  }

  // rank candidates and validate availability
  const ranked = [...CANDS]
    .map(c => ({ c, s: scoreCandidate(c, verticals, regionHint, radiusMiles, sizePref) }))
    .sort((a,b) => b.s - a.s)
    .slice(0, Math.max(14, limit + 4)) // over-sample before validation
    .map(x => x.c);

  const checks = await Promise.all(ranked.map(async (c) => {
    const ok = await isReachable(c.url);
    if (!ok) return null;
    const item: LeadItem = {
      host: c.host,
      platform: "web",
      title: `Supplier / vendor info | ${c.host}`,
      why_text: `${c.why} — source: live`,
      temp: "warm",
      created: ISO(),
    };
    return item;
  }));

  return checks.filter((x): x is LeadItem => Boolean(x)).slice(0, limit);
}

/* -------------------- routes -------------------- */

// recent saved (Refresh warm)
router.get("/warm", async (_req, res) => {
  try {
    await ensureLeadsTable();
    const r: any = await q(
      `SELECT host, platform, title, why_text, temp, created
       FROM leads ORDER BY created DESC LIMIT 50`
    );
    const items: LeadItem[] = (r?.rows ?? []).map((row: any) => ({
      host: row.host,
      platform: row.platform,
      title: row.title,
      why_text: row.why_text,
      temp: (row.temp as LeadTemp) ?? "warm",
      created: (row.created instanceof Date ? row.created.toISOString() : row.created) ?? ISO(),
    }));
    res.json({ ok: true, items });
  } catch {
    res.json({ ok: true, items: [] });
  }
});

// Find buyers (live + personalized)
router.get("/find-buyers", async (req, res) => {
  const supplierHost = String(req.query.host || "").trim().toLowerCase();
  if (!supplierHost) return res.status(400).json({ ok: false, error: "missing host" });

  const regionHint = String(req.query.region || "").trim(); // e.g., "US/CA"
  const radius = Math.max(0, Number(req.query.radius ?? 50) || 50);
  const sizeRaw = String(req.query.size || "").trim().toLowerCase();
  const sizePref: SizePref =
    sizeRaw === "mid" || sizeRaw === "large" || sizeRaw === "mega" || sizeRaw === "all"
      ? (sizeRaw as SizePref)
      : "balanced";
  const limit = Math.min(15, Math.max(1, Number(req.query.limit ?? 10) || 10));
  const catsParam = typeof req.query.cats === "string" ? req.query.cats : undefined;

  try {
    const liveItems = await liveSweepForBuyers(supplierHost, regionHint, radius, sizePref, limit, catsParam);
    await saveLeads(liveItems);
    res.json({
      ok: true,
      saved: liveItems.length,
      items: liveItems,
      latest_candidate: liveItems[0] ?? null,
      params: { regionHint, radius, sizePref, limit, cats: catsParam ?? null }
    });
  } catch {
    res.json({ ok: true, saved: 0, items: [] });
  }
});

// Deeper results (kept minimal; live returns enough)
router.post("/deepen", async (_req, res) => {
  res.json({ ok: true, queued: 0, note: "deepen stub; live sweep already returned items" });
});

export default router;