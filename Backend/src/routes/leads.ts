// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import { q } from '../shared/db'; // DO NOT CHANGE THIS PATH

const leads = Router();

type Temp = 'warm' | 'hot';
type Platform = 'web';
type Region = 'US' | 'CA' | 'NA';
type SizeBand = 'micro' | 'smb' | 'mid' | 'large' | 'mega';

export interface Candidate {
  host: string;
  platform: Platform;
  title: string;
  created: string;   // ISO
  temp: Temp;
  why: string;
}

/* ----------------- helpers ----------------- */

const nowISO = () => new Date().toISOString();

const normalizeHost = (input: string): string => {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const u = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
};

const has = (s: string, ...needles: string[]) =>
  needles.some(n => s.includes(n));

/** Try to infer the supplier’s packaging specialization from its domain. */
function inferPackagingCategoryFromHost(host: string): string[] {
  const h = host.toLowerCase();
  const cats: string[] = [];

  if (has(h, 'shrink', 'stretch', 'film', 'poly', 'plastic')) cats.push('food', 'beverage', 'retail');
  if (has(h, 'label', 'labels', 'sticker')) cats.push('beauty', 'beverage', 'cpg');
  if (has(h, 'box', 'boxes', 'corrug', 'carton')) cats.push('ecom', 'retail', 'food');
  if (has(h, 'bottle', 'cap', 'closure')) cats.push('beverage', 'beauty');
  if (has(h, 'pouch', 'bag', 'sachet')) cats.push('food', 'pet', 'cpg');
  if (has(h, 'tube', 'jar', 'cosmetic')) cats.push('beauty');
  if (has(h, 'foam')) cats.push('electronics', 'industrial');
  if (cats.length === 0) cats.push('cpg'); // default broad CPG

  // de-duplicate while preserving order
  return [...new Set(cats)];
}

/* ----------------- curated catalog seed -----------------
   This is a starter set; we’ll expand as we learn. Each entry is a “buyer”
   with high-prob supplier programs and size hints. */

interface BuyerSeed {
  host: string;
  titleHint?: string;
  regions: Region[];          // where they buy
  size: SizeBand;
  cats: string[];             // categories they buy packaging for
  vendorPaths?: string[];     // likely vendor / suppliers URLs
}

const CATALOG: BuyerSeed[] = [
  // FOOD / BEVERAGE (US/CA)
  { host: 'pepsico.com',                regions: ['US','NA'], size: 'mega', cats: ['beverage','cpg'], vendorPaths: ['/suppliers','/supplier-portal'] },
  { host: 'coca-colacompany.com',       regions: ['US','NA'], size: 'mega', cats: ['beverage'],      vendorPaths: ['/suppliers'] },
  { host: 'nestle.com',                 regions: ['NA'],       size: 'mega', cats: ['food','cpg'],    vendorPaths: ['/suppliers'] },
  { host: 'mondelezinternational.com',  regions: ['US','NA'],  size: 'mega', cats: ['food','cpg'],    vendorPaths: ['/suppliers'] },
  { host: 'generalmills.com',           regions: ['US','NA'],  size: 'large',cats: ['food','cpg'],    vendorPaths: ['/suppliers'] },
  { host: 'kraftheinzcompany.com',      regions: ['US','NA'],  size: 'large',cats: ['food','cpg'] },
  { host: 'conagra.com',                regions: ['US'],       size: 'large',cats: ['food','cpg'] },
  { host: 'hormelfoods.com',            regions: ['US'],       size: 'large',cats: ['food'] },
  { host: 'smuckers.com',               regions: ['US'],       size: 'mid',  cats: ['food'] },
  { host: 'danone.com',                 regions: ['NA'],       size: 'large',cats: ['food','beverage'] },
  { host: 'keurigdrpepper.com',         regions: ['US'],       size: 'large',cats: ['beverage'] },
  { host: 'postholdings.com',           regions: ['US'],       size: 'mid',  cats: ['food'] },

  // BEAUTY / PERSONAL CARE
  { host: 'loreal.com',                 regions: ['NA'],       size: 'mega', cats: ['beauty','cpg'], vendorPaths: ['/supplier-portal','/suppliers'] },
  { host: 'estee.com',                  regions: ['US','NA'],  size: 'large',cats: ['beauty'] },
  { host: 'pdcbeauty.com',              regions: ['US'],       size: 'mid',  cats: ['beauty'] },
  { host: 'elfcosmetics.com',           regions: ['US'],       size: 'mid',  cats: ['beauty'] },

  // RETAIL / GROCERY (lots of own-brand packaging)
  { host: 'walmart.com',                regions: ['US','NA'],  size: 'mega', cats: ['retail','ecom'] },
  { host: 'target.com',                 regions: ['US'],       size: 'mega', cats: ['retail','ecom'] },
  { host: 'loblaw.ca',                  regions: ['CA'],       size: 'large',cats: ['retail','food'] },
  { host: 'kroger.com',                 regions: ['US'],       size: 'large',cats: ['retail','food'] },
  { host: 'albertsons.com',             regions: ['US'],       size: 'large',cats: ['retail','food'] },
  { host: 'heb.com',                    regions: ['US'],       size: 'mid',  cats: ['retail','food'] },
  { host: 'meijer.com',                 regions: ['US'],       size: 'mid',  cats: ['retail','food'] },

  // PET / SPECIALTY CPG
  { host: 'chewy.com',                  regions: ['US'],       size: 'large',cats: ['pet','ecom'] },
  { host: 'freshpet.com',               regions: ['US'],       size: 'mid',  cats: ['pet','food'] },
  { host: 'bluebuffalo.com',            regions: ['US'],       size: 'mid',  cats: ['pet'] },

  // QSR / RESTAURANT (to-go packaging)
  { host: 'mcdonalds.com',              regions: ['NA'],       size: 'mega', cats: ['food','qsr'] },
  { host: 'starbucks.com',              regions: ['US','NA'],  size: 'mega', cats: ['beverage','qsr'] },
  { host: 'chipotle.com',               regions: ['US'],       size: 'large',cats: ['food','qsr'] },

  // BREWERIES / MID-MARKET BEVERAGE
  { host: 'sierraNevada.com',           regions: ['US'],       size: 'smb',  cats: ['beverage'] },
  { host: 'lagunitas.com',              regions: ['US'],       size: 'smb',  cats: ['beverage'] },
  { host: 'canarchy.beer',              regions: ['US'],       size: 'mid',  cats: ['beverage'] },

  // HOUSEHOLD / CLEANING
  { host: 'clorox.com',                 regions: ['US','NA'],  size: 'large',cats: ['cpg'] },
  { host: 'scjohnson.com',              regions: ['US','NA'],  size: 'large',cats: ['cpg'] },

  // ECOM BRANDS (fast-moving, lighter vendor processes)
  { host: 'hellofresh.com',             regions: ['US','NA'],  size: 'large',cats: ['food','ecom'] },
  { host: 'dailyharvest.com',           regions: ['US'],       size: 'smb',  cats: ['food','ecom'] },
  { host: 'thriveMarket.com',           regions: ['US'],       size: 'mid',  cats: ['food','ecom'] },
];

/* ----------------- scoring & selection ----------------- */

interface Context {
  supplierHost: string;
  regionPref?: 'US' | 'CA';
}

function sizeWeight(size: SizeBand): number {
  // SMB-first bias (avoid only mega unless nothing else)
  switch (size) {
    case 'smb':  return 1.0;
    case 'mid':  return 0.95;
    case 'large':return 0.7;
    case 'mega': return 0.25;
    default:     return 0.6;
  }
}

function scoreBuyer(seed: BuyerSeed, ctx: Context, wantedCats: string[]): number {
  let s = 0;

  // Category match (most important)
  const catHits = seed.cats.filter(c => wantedCats.includes(c)).length;
  s += catHits * 40;

  // Region match
  if (ctx.regionPref && seed.regions.includes(ctx.regionPref)) s += 15;
  else if (seed.regions.includes('NA')) s += 8;

  // Size bias
  s += 30 * sizeWeight(seed.size);

  // Known vendor page boost
  if (seed.vendorPaths && seed.vendorPaths.length) s += 10;

  // Very weak jitter for variety
  s += (seed.host.length % 7);

  return s;
}

/* ----------------- persistence: dedupe window ----------------- */

async function ensureTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS suggestion_log (
      id BIGSERIAL PRIMARY KEY,
      supplier_host TEXT NOT NULL,
      suggested_host TEXT NOT NULL,
      created TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS suggestion_log_recent_idx
      ON suggestion_log (supplier_host, created DESC);
  `);
}

async function recentlySuggested(supplierHost: string): Promise<Set<string>> {
  const { rows } = await q(
    `SELECT suggested_host
       FROM suggestion_log
      WHERE supplier_host = $1
        AND created > now() - interval '24 hours'
      LIMIT 50;`,
    [supplierHost]
  );
  return new Set(rows.map(r => String(r.suggested_host)));
}

async function logSuggestion(supplierHost: string, buyerHost: string) {
  await q(
    `INSERT INTO suggestion_log (supplier_host, suggested_host) VALUES ($1,$2);`,
    [supplierHost, buyerHost]
  );
}

/* ----------------- candidate picker ----------------- */

async function pickSmartCandidate(host: string, region?: string): Promise<Candidate | null> {
  const supplier = normalizeHost(host);
  const regionPref = region?.includes('CA') ? 'CA' : region?.includes('US') ? 'US' : undefined;

  const wantedCats = inferPackagingCategoryFromHost(supplier);
  await ensureTables();
  const seen = await recentlySuggested(supplier);

  // score & rank
  const ctx: Context = { supplierHost: supplier, regionPref };
  const ranked = CATALOG
    .filter(s => s.host !== supplier)                       // never the supplier
    .filter(s => !seen.has(s.host))                         // avoid repeats
    .map(s => ({ seed: s, score: scoreBuyer(s, ctx, wantedCats) }))
    .sort((a, b) => b.score - a.score);

  // prefer non-mega top 1; if only mega left, still return something
  let chosen = ranked.find(r => r.seed.size !== 'mega') ?? ranked[0];
  if (!chosen) return null;

  const chosenHost = chosen.seed.host;

  // Compose title & why
  const title = chosen.seed.titleHint
    ? chosen.seed.titleHint
    : `Suppliers / vendor info | ${chosenHost}`;

  const whyReason = [
    wantedCats.length ? `fit: ${wantedCats.join('/')}` : '',
    regionPref ? `region: ${regionPref}` : '',
    `size: ${chosen.seed.size}`,
    chosen.seed.vendorPaths?.length ? 'vendor page known' : ''
  ].filter(Boolean).join(' · ');

  const cand: Candidate = {
    host: chosenHost,
    platform: 'web',
    title,
    created: nowISO(),
    temp: 'warm',
    why: `${whyReason || 'match'} (picked for supplier: ${supplier})`
  };

  // Record to dedupe next calls
  await logSuggestion(supplier, chosenHost);

  return cand;
}

/* ----------------- routes ----------------- */

// GET /api/leads/find-buyers?host=...&region=US%2FCA&radius=50+mi
leads.get('/find-buyers', async (req: Request, res: Response) => {
  const { host, region } = req.query as { host?: string; region?: string; radius?: string };
  if (!host) return res.status(400).json({ error: 'host is required' });

  try {
    const cand = await pickSmartCandidate(host, region);
    if (!cand) return res.status(404).json({ error: 'no match' });
    return res.json(cand);
  } catch (err: any) {
    return res.status(500).json({ error: 'internal', detail: String(err?.message || err) });
  }
});

// POST /api/leads/lock { host, title, temp? }
leads.post('/lock', async (req: Request, res: Response) => {
  const { host, title, temp } = (req.body ?? {}) as { host?: string; title?: string; temp?: Temp };
  if (!host || !title) return res.status(400).json({ error: 'candidate with host and title required' });

  const created = nowISO();
  const h = normalizeHost(host);
  const t: Temp = temp === 'hot' ? 'hot' : 'warm';

  try {
    await q(`
      CREATE TABLE IF NOT EXISTS buyer_locks (
        id BIGSERIAL PRIMARY KEY,
        host TEXT NOT NULL,
        title TEXT NOT NULL,
        temp TEXT NOT NULL,
        created TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await q(
      `INSERT INTO buyer_locks (host, title, temp, created)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING;`,
      [h, title, t, created]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'lock_failed', detail: String(err?.message || err) });
  }
});

export default leads;
export { leads as leadsRouter };