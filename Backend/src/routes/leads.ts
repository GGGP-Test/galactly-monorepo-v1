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
  return new Set(rows.map(r => String