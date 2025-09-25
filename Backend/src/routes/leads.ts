// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import { q } from '../shared/db';

const leads = Router();

/* ========== types ========== */

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

/* ========== tiny utils ========== */

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

const has = (s: string, ...needles: string[]) => needles.some(n => s.includes(n));

/* ========== category inference from supplier host ========== */

function inferPackagingCategoryFromHost(host: string): string[] {
  const h = host.toLowerCase();
  const cats: string[] = [];

  if (has(h, 'shrink', 'stretch', 'film', 'poly', 'plastic')) cats.push('food','beverage','retail');
  if (has(h, 'label', 'labels', 'sticker')) cats.push('beauty','beverage','cpg','retail');
  if (has(h, 'box', 'boxes', 'corrug', 'carton')) cats.push('ecom','retail','food');
  if (has(h, 'bottle', 'cap', 'closure')) cats.push('beverage','beauty');
  if (has(h, 'pouch', 'bag', 'sachet')) cats.push('food','pet','cpg');
  if (has(h, 'tube', 'jar', 'cosmetic')) cats.push('beauty');
  if (has(h, 'mailer', 'void', 'foam')) cats.push('ecom','electronics','industrial');
  if (cats.length === 0) cats.push('cpg'); // broad default

  return [...new Set(cats)];
}

/* ========== catalog seed (expanded mid-market) ========== */

interface BuyerSeed {
  host: string;
  titleHint?: string;
  regions: Region[];
  size: SizeBand;
  cats: string[];
  vendorPaths?: string[];
}

const CATALOG: BuyerSeed[] = [
  // ---- FOOD / BEV (mix of mid/large, US & CA)
  { host: 'generalmills.com', regions: ['US','NA'], size: 'large', cats: ['food','cpg'], vendorPaths: ['/suppliers'] },
  { host: 'postholdings.com', regions: ['US'], size: 'mid', cats: ['food'] },
  { host: 'smuckers.com', regions: ['US'], size: 'mid', cats: ['food'] },
  { host: 'danone.com', regions: ['NA'], size: 'large', cats: ['food','beverage'] },
  { host: 'conagra.com', regions: ['US'], size: 'large', cats: ['food','cpg'] },
  { host: 'hormelfoods.com', regions: ['US'], size: 'large', cats: ['food'] },
  { host: 'kraftheinzcompany.com', regions: ['US','NA'], size: 'large', cats: ['food','cpg'] },

  // ---- BEAUTY / PERSONAL CARE (bias to mid)
  { host: 'pdcbeauty.com', regions: ['US'], size: 'mid', cats: ['beauty'], vendorPaths: ['/suppliers','/supplier-portal'] },
  { host: 'elfcosmetics.com', regions: ['US'], size: 'mid', cats: ['beauty'] },
  { host: 'loreal.com', regions: ['NA'], size: 'mega', cats: ['beauty','cpg'], vendorPaths: ['/supplier-portal','/suppliers'] }, // mega kept (fallback)

  // ---- RETAIL / GROCERY (own-brand)
  { host: 'loblaw.ca', regions: ['CA'], size: 'large', cats: ['retail','food'], vendorPaths: ['/suppliers'] },
  { host: 'heb.com', regions: ['US'], size: 'mid', cats: ['retail','food'] },
  { host: 'meijer.com', regions: ['US'], size: 'mid', cats: ['retail','food'] },
  { host: 'aldi.us', regions: ['US'], size: 'mid', cats: ['retail','food'] },
  { host: 'traderjoes.com', regions: ['US'], size: 'mid', cats: ['retail','food'] },

  // ---- PET
  { host: 'freshpet.com', regions: ['US'], size: 'mid', cats: ['pet','food'] },
  { host: 'bluebuffalo.com', regions: ['US'], size: 'mid', cats: ['pet'] },

  // ---- QSR / FOOD SERVICE (to-go)
  { host: 'chipotle.com', regions: ['US'], size: 'large', cats: ['food','qsr'] },
  { host: 'panerabread.com', regions: ['US'], size: 'mid', cats: ['food','qsr'] },

  // ---- MID-BEVERAGE (breweries)
  { host: 'sierranevada.com', regions: ['US'], size: 'smb', cats: ['beverage'] },
  { host: 'lagunitas.com', regions: ['US'], size: 'smb', cats: ['beverage'] },
  { host: 'canarchy.beer', regions: ['US'], size: 'mid', cats: ['beverage'] },

  // ---- HOUSEHOLD
  { host: 'clorox.com', regions: ['US','NA'], size: 'large', cats: ['cpg'] },
  { host: 'scjohnson.com', regions: ['US','NA'], size: 'large', cats: ['cpg'] },

  // ---- ECOM BRANDS
  { host: 'hellofresh.com', regions: ['US','NA'], size: 'large', cats: ['food','ecom'] },
  { host: 'dailyharvest.com', regions: ['US'], size: 'smb', cats: ['food','ecom'] },
  { host: 'thrivemarket.com', regions: ['US'], size: 'mid', cats: ['food','ecom'] },

  // ---- BIGS (fallbacks only; we deprioritize)
  { host: 'pepsico.com', regions: ['US','NA'], size: 'mega', cats: ['beverage','cpg'], vendorPaths: ['/suppliers','/supplier-portal'] },
  { host: 'coca-colacompany.com', regions: ['US','NA'], size: 'mega', cats: ['beverage'], vendorPaths: ['/suppliers'] },
  { host: 'nestle.com', regions: ['NA'], size: 'mega', cats: ['food','cpg'], vendorPaths: ['/suppliers'] },
];

/* ========== scoring & web-probe ========== */

interface Context {
  supplierHost: string;
  regionPref?: 'US' | 'CA';
  avoidMega: boolean;
  sizeBias?: 'smb' | 'mid' | 'any';
}

function sizeWeight(size: SizeBand, bias?: 'smb' | 'mid' | 'any'): number {
  const base: Record<SizeBand, number> = {
    micro: 1.0, smb: 0.98, mid: 0.92, large: 0.65, mega: 0.2
  };
  let w = base[size] ?? 0.6;
  if (bias === 'smb' && (size === 'smb' || size === 'micro')) w += 0.10;
  if (bias === 'mid' && size === 'mid') w += 0.10;
  return Math.max(0, Math.min(1.1, w));
}

function scoreBuyer(seed: BuyerSeed, ctx: Context, wantedCats: string[]): number {
  let s = 0;

  // Category match (dominant)
  const catHits = seed.cats.filter(c => wantedCats.includes(c)).length;
  s += catHits * 45;

  // Region
  if (ctx.regionPref && seed.regions.includes(ctx.regionPref)) s += 15;
  else if (seed.regions.includes('NA')) s += 8;

  // Size
  s += 30 * sizeWeight(seed.size, ctx.sizeBias);

  // Vendor hints
  if (seed.vendorPaths?.length) s += 8;

  // Avoid mega unless allowed
  if (ctx.avoidMega && seed.size === 'mega') s -= 20;

  // light jitter
  s += (seed.host.length % 7);

  return s;
}

// Quick HEAD probe with timeout; non-blocking (we’ll probe only a shortlist)
async function headOk(url: string, ms = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    return r.ok || (r.status >= 300 && r.status < 400);
  } catch {
    return false;
  }
}

async function vendorSignal(host: string, explicit?: string[]): Promise<number> {
  const base = `https://${host}`;
  const candidates = [
    ...(explicit ?? []),
    '/suppliers', '/supplier', '/supplier-portal', '/vendors', '/supplierinformation'
  ];
  // probe at most 2 paths to hold latency down
  const tries = candidates.slice(0, 2);
  const results = await Promise.all(tries.map(p => headOk(base + p)));
  if (results.some(Boolean)) return +12;    // strong boost
  if (explicit && explicit.length) return -6; // claimed vendor page but none found
  return 0;                                  // neutral
}

/* ========== persistence: dedupe window ========== */

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

/* ========== candidate selection ========== */

function inferRegionFromTld(host: string): 'US' | 'CA' | undefined {
  if (host.endsWith('.ca')) return 'CA';
  if (host.endsWith('.us')) return 'US';
  return undefined;
}

async function pickSmartCandidate(host: string, region?: string, opts?: { avoidMega?: boolean; bias?: 'smb'|'mid'|'any'; cats?: string[] }): Promise<Candidate | null> {
  const supplier = normalizeHost(host);
  const wantedCats = opts?.cats && opts.cats.length ? opts.cats : inferPackagingCategoryFromHost(supplier);

  const regionPref = region?.includes('CA')
    ? 'CA'
    : region?.includes('US')
    ? 'US'
    : inferRegionFromTld(supplier);

  await ensureTables();
  const seen = await recentlySuggested(supplier);

  const ctx: Context = {
    supplierHost: supplier,
    regionPref,
    avoidMega: opts?.avoidMega ?? true,
    sizeBias: opts?.bias ?? 'smb'
  };

  // Stage 1: raw scoring
  const scored = CATALOG
    .filter(s => s.host !== supplier)
    .filter(s => !seen.has(s.host))
    .map(s => ({ seed: s, score: scoreBuyer(s, ctx, wantedCats) }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  // Stage 2: probe vendor pages for the top 12 only
  const topN = scored.slice(0, 12);
  const boosts = await Promise.all(
    topN.map(x => vendorSignal(x.seed.host, x.seed.vendorPaths))
  );
  for (let i = 0; i < topN.length; i++) topN[i].score += boosts[i];

  // Re-rank with boosts
  topN.sort((a, b) => b.score - a.score);

  // Prefer non-mega; if only mega remains, take best mega
  let chosen = topN.find(r => r.seed.size !== 'mega') ?? topN[0];
  const picked = chosen.seed;

  const title = picked.titleHint ?? `Suppliers / vendor info | ${picked.host}`;
  const whyChunks = [
    wantedCats.length ? `fit: ${wantedCats.join('/')}` : '',
    regionPref ? `region: ${regionPref}` : '',
    `size: ${picked.size}`,
    (boosts[topN.indexOf(chosen)] ?? 0) > 0 ? 'vendor page verified' : (picked.vendorPaths?.length ? 'vendor page known' : '')
  ].filter(Boolean);

  const cand: Candidate = {
    host: picked.host,
    platform: 'web',
    title,
    created: nowISO(),
    temp: 'warm',
    why: `${whyChunks.join(' · ')} (picked for supplier: ${supplier})`
  };

  await logSuggestion(supplier, picked.host);
  return cand;
}

/* ========== routes ========== */

// GET /api/leads/find-buyers?host=...&region=US%2FCA&bias=smb|mid|any&avoidMega=true|false&cats=food,beauty
leads.get('/find-buyers', async (req: Request, res: Response) => {
  const { host, region, bias, avoidMega, cats } = req.query as Record<string, string | undefined>;
  if (!host) return res.status(400).json({ error: 'host is required' });

  try {
    const cand = await pickSmartCandidate(
      host,
      region,
      {
        bias: (bias === 'mid' || bias === 'any') ? (bias as any) : 'smb',
        avoidMega: avoidMega === 'false' ? false : true,
        cats: cats ? cats.split(',').map(s => s.trim()).filter(Boolean) : undefined
      }
    );
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