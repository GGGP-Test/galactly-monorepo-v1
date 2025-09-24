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

// --- tiny fetch helpers ---
async function isReachable(url: string, timeoutMs = 4500): Promise<boolean> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    let r = await fetch(url, { method: "HEAD", signal: c.signal });
    if (!r.ok || (r.status >= 500 && r.status <= 599)) {
      r = await fetch(url, { method: "GET", redirect: "follow", signal: c.signal });
    }
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, timeoutMs = 5000): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "GET", signal: c.signal });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

// --- DB save (best effort, non-blocking feel) ---
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
    const valuesSql = items.map((_, i) =>
      `($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`
    ).join(",");
    const params = items.flatMap(x => [x.host, x.platform, x.title, x.why_text, x.temp, x.created]);
    await q(
      `INSERT INTO leads (host, platform, title, why_text, temp, created) VALUES ${valuesSql};`,
      params as any[]
    );
  } catch { /* swallow to keep UX snappy */ }
}

// --- vertical inference from supplier site ---
type Vertical = "food_bev" | "beauty_personal" | "household" | "pet" | "generic";
function inferVertical(html: string): Vertical {
  const h = html.toLowerCase();
  if (/\b(food|beverage|snack|drink|bottl|can|frozen|grocery|dairy|confection|brew|coffee|tea)\b/.test(h)) return "food_bev";
  if (/\b(cosmetic|beauty|skincare|fragrance|personal care|haircare|soap|shampoo|lotion|makeup)\b/.test(h)) return "beauty_personal";
  if (/\b(cleaning|laundry|detergent|air care|home care|household)\b/.test(h)) return "household";
  if (/\b(pet|cat|dog|treats|kibble|litter)\b/.test(h)) return "pet";
  return "generic";
}

// curated portals – chosen to actually accept packaging/indirect suppliers
const BASE_CANDIDATES: Record<Vertical, { host: string; url: string; why: string }[]> = {
  food_bev: [
    { host: "thecloroxcompany.com", url: "https://www.thecloroxcompany.com/partners/suppliers/", why: "supplier guidelines / onboarding" }, // household too, but buys tons of packaging
    { host: "jmsmucker.com", url: "https://www.jmsmucker.com/about/suppliers", why: "supplier information" },
    { host: "campbellsoupcompany.com", url: "https://www.campbellsoupcompany.com/about-us/suppliers/", why: "supplier info / onboarding" },
    { host: "hormelfoods.com", url: "https://www.hormelfoods.com/about/suppliers/", why: "supplier portal" },
    { host: "keurigdrpepper.com", url: "https://www.keurigdrpepper.com/en/our-company/suppliers", why: "supplier information" },
    { host: "kroger.com", url: "https://www.thekrogerco.com/vendors-suppliers/", why: "retail vendor portal" },
    { host: "albertsons.com", url: "https://www.albertsons.com/our-company/doing-business-with-us.html", why: "retail vendor information" },
    { host: "target.com", url: "https://corporate.target.com/suppliers", why: "retail supplier hub" },
    { host: "wholefoodsmarket.com", url: "https://www.wholefoodsmarket.com/company-info/suppliers", why: "retail supplier info" },
  ],
  beauty_personal: [
    { host: "elcompanies.com", url: "https://www.elcompanies.com/en/our-suppliers", why: "Estée Lauder supplier info" },
    { host: "loreal.com", url: "https://www.loreal.com/en/suppliers", why: "L'Oréal supplier portal" },
    { host: "edgewell.com", url: "https://edgewell.com/suppliers/", why: "supplier resources" },
    { host: "coty.com", url: "https://www.coty.com/suppliers", why: "supplier guidelines" },
    { host: "bathandbodyworks.com", url: "https://www.bbwinc.com/suppliers", why: "supplier / vendor info" },
    { host: "ulta.com", url: "https://www.ulta.com/company/suppliers", why: "retail supplier info" },
    { host: "target.com", url: "https://corporate.target.com/suppliers", why: "retail supplier hub" },
  ],
  household: [
    { host: "thecloroxcompany.com", url: "https://www.thecloroxcompany.com/partners/suppliers/", why: "supplier onboarding" },
    { host: "scjohnson.com", url: "https://www.scjohnson.com/en/our-company/suppliers", why: "supplier information" },
    { host: "henkel.com", url: "https://www.henkel.com/company/suppliers", why: "supplier portal" },
    { host: "churchdwight.com", url: "https://churchdwight.com/suppliers", why: "supplier-registration" },
    { host: "kroger.com", url: "https://www.thekrogerco.com/vendors-suppliers/", why: "retail vendor portal" },
    { host: "costco.com", url: "https://www.costco.com/about-costco-vendor-inquiries.html", why: "retail vendor inquiries" },
    { host: "target.com", url: "https://corporate.target.com/suppliers", why: "retail supplier hub" },
  ],
  pet: [
    { host: "petco.com", url: "https://www.petco.com/content/petco/about/petco-suppliers.html", why: "vendor / supplier info" },
    { host: "petsmart.com", url: "https://corporate.petsmart.com/suppliers", why: "supplier information" },
    { host: "chewy.com", url: "https://www.chewy.com/g/vendor-inquiry", why: "vendor inquiry" },
    { host: "kroger.com", url: "https://www.thekrogerco.com/vendors-suppliers/", why: "retail vendor portal" },
    { host: "albertsons.com", url: "https://www.albertsons.com/our-company/doing-business-with-us.html", why: "retail vendor information" },
  ],
  generic: [
    // generic still tries to stay practical (retail + CPG supplier portals)
    { host: "thecloroxcompany.com", url: "https://www.thecloroxcompany.com/partners/suppliers/", why: "supplier onboarding" },
    { host: "churchdwight.com", url: "https://churchdwight.com/suppliers", why: "supplier-registration" },
    { host: "coca-colacompany.com", url: "https://www.coca-colacompany.com/suppliers", why: "supplier portal" },
    { host: "jmsmucker.com", url: "https://www.jmsmucker.com/about/suppliers", why: "supplier information" },
    { host: "kroger.com", url: "https://www.thekrogerco.com/vendors-suppliers/", why: "retail vendor portal" },
    { host: "albertsons.com", url: "https://www.albertsons.com/our-company/doing-business-with-us.html", why: "retail vendor information" },
    { host: "target.com", url: "https://corporate.target.com/suppliers", why: "retail supplier hub" },
    { host: "costco.com", url: "https://www.costco.com/about-costco-vendor-inquiries.html", why: "retail vendor inquiries" },
  ],
};

// build candidates by vertical; cap to keep fast
function buildCandidates(v: Vertical) {
  // De-dup, keep at most ~10
  const list = BASE_CANDIDATES[v] ?? BASE_CANDIDATES.generic;
  const seen = new Set<string>();
  const out: { host: string; url: string; why: string }[] = [];
  for (const c of list) {
    if (seen.has(c.host)) continue;
    seen.add(c.host);
    out.push(c);
    if (out.length >= 12) break;
  }
  return out;
}

async function liveSweepForBuyers(supplierHost: string): Promise<LeadItem[]> {
  // fetch supplier homepage → guess vertical
  let v: Vertical = "generic";
  try {
    const html = await fetchText(`https://${supplierHost}/`);
    if (html) v = inferVertical(html);
  } catch {
    v = "generic";
  }

  const candidates = buildCandidates(v);

  const checks = await Promise.all(
    candidates.map(async (c) => {
      const ok = await isReachable(c.url);
      if (!ok) return null;
      return <LeadItem>{
        host: c.host,
        platform: "web",
        title: `Supplier / vendor info | ${c.host}`,
        why_text: `${c.why} — source: live`,
        temp: "warm",
        created: ISO(),
      };
    })
  );

  return checks.filter((x): x is LeadItem => Boolean(x)).slice(0, 10);
}

// ---------- Routes ----------

// recent saved (for Refresh warm)
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

// live sweep (Find buyer)
router.get("/find-buyers", async (req, res) => {
  const supplierHost = String(req.query.host || "").trim().toLowerCase();
  if (!supplierHost) return res.status(400).json({ ok: false, error: "missing host" });

  try {
    const liveItems = await liveSweepForBuyers(supplierHost);
    await saveLeads(liveItems); // best-effort
    res.json({
      ok: true,
      saved: liveItems.length,
      items: liveItems,
      latest_candidate: liveItems[0] ?? null,
    });
  } catch {
    res.json({ ok: true, saved: 0, items: [] });
  }
});

// stub (kept for UI button)
router.post("/deepen", async (_req, res) => {
  res.json({ ok: true, queued: 0, note: "deepen stub; live sweep already returned items" });
});

export default router;