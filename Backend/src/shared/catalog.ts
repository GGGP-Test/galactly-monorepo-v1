// src/shared/catalog.ts
//
// City-tagged Tier-C buyer catalog loader + scorer.
// Reads a JSONL secret (one JSON object per line) and exposes
// helpers to retrieve / score relevant buyers for a supplier's prefs.

import fs from 'fs';
import path from 'path';
import { DEFAULT_PREFS, Prefs } from './prefs';

/* ----------------------------------------------------------------------------
 * Types
 * --------------------------------------------------------------------------*/

export type BuyerSize = 'micro' | 'small' | 'mid' | 'large';
export type BuyerTier = 'A' | 'B' | 'C';

export interface BuyerRow {
  // required
  host: string;                 // buyer domain, e.g. "coolbrand.com"
  name: string;                 // friendly company name

  // location
  city?: string;                // e.g. "Los Angeles"
  state?: string;               // e.g. "CA"
  country?: string;             // "US" | "CA" | other

  // meta
  size: BuyerSize;              // micro/small/mid/large
  tier: BuyerTier;              // we target "C" here
  categories: string[];         // lowercase tags, e.g. ["food","beverage","d2c"]
  tags?: string[];              // extra flags: ["ecommerce","retail","wholesale", ...]
}

export interface ScoredBuyer {
  buyer: BuyerRow;
  score: number;                // higher is better
  why: string;                  // human readable explanation
}

/* ----------------------------------------------------------------------------
 * Secret / Source resolution
 * --------------------------------------------------------------------------*/

function readFromEnvOrFile(): string {
  const file = (process.env.CATALOG_CITY_FILE || '').trim();
  if (file) {
    try {
      const p = path.resolve(file);
      return fs.readFileSync(p, 'utf8');
    } catch (e) {
      // fall through; try env content
    }
  }
  const inline = process.env.CATALOG_CITY_JSONL;
  if (inline && inline.trim()) return inline;

  return ''; // empty -> fallback later
}

/* ----------------------------------------------------------------------------
 * Parse JSONL (ignore blank/comments)
 * --------------------------------------------------------------------------*/

function parseJSONL(text: string): BuyerRow[] {
  const out: BuyerRow[] = [];
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue;
    try {
      const obj = JSON.parse(raw);
      // minimal validation
      if (!obj || typeof obj !== 'object') continue;
      const host = String(obj.host || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
      const name = (obj.name ?? host || '').toString().trim();
      const size = (obj.size || 'small') as BuyerSize;
      const tier = (obj.tier || 'C') as BuyerTier;
      const categories: string[] = Array.isArray(obj.categories) ? obj.categories.map((c: any) => String(c || '').toLowerCase().trim()).filter(Boolean) : [];
      const tags: string[] = Array.isArray(obj.tags) ? obj.tags.map((t: any) => String(t || '').toLowerCase().trim()).filter(Boolean) : [];

      if (!host) continue;

      out.push({
        host,
        name,
        city: obj.city ? String(obj.city).trim() : undefined,
        state: obj.state ? String(obj.state).trim() : undefined,
        country: obj.country ? String(obj.country).trim() : undefined,
        size,
        tier,
        categories,
        tags,
      });
    } catch {
      // ignore bad line; keep parsing
    }
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * In-memory cache
 * --------------------------------------------------------------------------*/

let CATALOG: BuyerRow[] | null = null;
let LOAD_ERR: string | null = null;

function loadCatalogOnce(): BuyerRow[] {
  if (CATALOG) return CATALOG;
  try {
    const raw = readFromEnvOrFile();
    const parsed = parseJSONL(raw);

    // Fallback sample (keeps system usable without secrets)
    const sample: BuyerRow[] = [
      {
        host: 'angelcitybrewing.com',
        name: 'Angel City Brewing',
        city: 'Los Angeles',
        state: 'CA',
        country: 'US',
        size: 'small',
        tier: 'C',
        categories: ['beverage', 'beer', 'd2c'],
        tags: ['retail', 'wholesale']
      },
      {
        host: 'goldenstatetea.com',
        name: 'Golden State Tea',
        city: 'San Jose',
        state: 'CA',
        country: 'US',
        size: 'micro',
        tier: 'C',
        categories: ['beverage', 'tea', 'ecommerce'],
        tags: ['ecommerce']
      },
      {
        host: 'brooklynbotanicals.com',
        name: 'Brooklyn Botanicals',
        city: 'New York',
        state: 'NY',
        country: 'US',
        size: 'small',
        tier: 'C',
        categories: ['beauty', 'cosmetics', 'retail'],
        tags: ['retail', 'ecommerce']
      },
    ];

    CATALOG = (parsed && parsed.length ? parsed : sample).map(normalizeBuyerRow);
    LOAD_ERR = null;
  } catch (e: any) {
    LOAD_ERR = e?.message || 'catalog load failed';
    CATALOG = [];
  }
  return CATALOG!;
}

function normalizeBuyerRow(b: BuyerRow): BuyerRow {
  return {
    ...b,
    host: String(b.host || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .trim(),
    name: (b.name || b.host).toString().trim(),
    city: b.city?.toString().trim(),
    state: b.state?.toString().trim(),
    country: (b.country || 'US').toString().trim(),
    size: (b.size || 'small') as BuyerSize,
    tier: (b.tier || 'C') as BuyerTier,
    categories: (b.categories || []).map(s => String(s || '').toLowerCase().trim()).filter(Boolean),
    tags: (b.tags || []).map(s => String(s || '').toLowerCase().trim()).filter(Boolean),
  };
}

/* ----------------------------------------------------------------------------
 * Scoring
 * --------------------------------------------------------------------------*/

function bool(v: any): boolean { return v === true || v === 'true' || v === 1; }
function sameCity(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function intersectCount(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(a.map(x => x.toLowerCase()));
  let c = 0;
  for (const y of b) if (set.has(y.toLowerCase())) c++;
  return c;
}

export function scoreBuyer(b: BuyerRow, prefs: Prefs): { score: number; why: string[] } {
  const why: string[] = [];

  // Base: prefer small/mid; avoid large if preferSmallMid=true
  let s = 0;

  const sizeW = prefs.sizeWeight || DEFAULT_PREFS.sizeWeight;
  const sizeScore =
    b.size === 'micro' ? sizeW.micro :
    b.size === 'small' ? sizeW.small :
    b.size === 'mid'   ? sizeW.mid   :
    sizeW.large;

  s += sizeScore;
  why.push(`size:${b.size} (${sizeScore >= 0 ? '+' : ''}${sizeScore.toFixed(2)})`);

  // Tier nudges (we’re focusing C/B by default)
  if (prefs.tierFocus.includes(b.tier)) {
    s += (b.tier === 'C' ? 0.6 : 0.2);
    why.push(`tier:${b.tier} (+${b.tier === 'C' ? '0.6' : '0.2'})`);
  } else {
    s -= 0.4;
    why.push(`tier:${b.tier} (-0.4)`);
  }

  // Locality
  if (prefs.city && sameCity(prefs.city, b.city)) {
    const w = prefs.signalWeight.local;
    s += w;
    why.push(`local:${b.city} (+${w.toFixed(2)})`);
  }

  // Category allow/block
  const allowHits = intersectCount(prefs.categoriesAllow, b.categories);
  if (prefs.categoriesAllow.length && allowHits > 0) {
    const bump = Math.min(allowHits * 0.4, 1.5);
    s += bump;
    why.push(`allow:${allowHits} (+${bump.toFixed(2)})`);
  }
  const blockHits = intersectCount(prefs.categoriesBlock, b.categories);
  if (prefs.categoriesBlock.length && blockHits > 0) {
    const pen = Math.min(blockHits * 0.7, 2.0);
    s -= pen;
    why.push(`block:${blockHits} (-${pen.toFixed(2)})`);
  }

  // Channel tags
  const tset = new Set((b.tags || []).map(x => x.toLowerCase()));
  if (tset.has('ecommerce')) { s += prefs.signalWeight.ecommerce; why.push(`ecommerce (+${prefs.signalWeight.ecommerce})`); }
  if (tset.has('retail'))    { s += prefs.signalWeight.retail;    why.push(`retail (+${prefs.signalWeight.retail})`); }
  if (tset.has('wholesale')) { s += prefs.signalWeight.wholesale; why.push(`wholesale (+${prefs.signalWeight.wholesale})`); }

  // Anti-giant guard
  if (prefs.preferSmallMid && b.size === 'large') {
    s -= 1.2;
    why.push('anti-giant (-1.2)');
  }

  // Clamp and finish
  const score = Math.max(-5, Math.min(8, s));
  return { score, why };
}

/* ----------------------------------------------------------------------------
 * Query helpers
 * --------------------------------------------------------------------------*/

export interface FindOptions {
  limit?: number;
  cityFirst?: boolean;   // true = rank exact-city matches above others
}

export function findTierC(prefs: Prefs, opts: FindOptions = {}): ScoredBuyer[] {
  const catalog = loadCatalogOnce();
  if (!catalog.length) return [];

  const focusSet = new Set((prefs.tierFocus || ['C', 'B']).map(x => x.toUpperCase()));
  const pool = catalog.filter(b => focusSet.has((b.tier || 'C').toUpperCase()));

  const scored = pool.map(b => {
    const { score, why } = scoreBuyer(b, prefs);
    return { buyer: b, score, why: why.join(' • ') } as ScoredBuyer;
  });

  // Prefer city matches if requested
  if (opts.cityFirst && prefs.city) {
    const city = prefs.city.toLowerCase();
    scored.sort((a, b) => {
      const aCity = (a.buyer.city || '').toLowerCase() === city ? 1 : 0;
      const bCity = (b.buyer.city || '').toLowerCase() === city ? 1 : 0;
      if (aCity !== bCity) return bCity - aCity; // city matches first
      return b.score - a.score;                  // then score
    });
  } else {
    scored.sort((a, b) => b.score - a.score);
  }

  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  return scored.slice(0, limit);
}

/* ----------------------------------------------------------------------------
 * Admin / Debug helpers (optional)
 * --------------------------------------------------------------------------*/

export function catalogSize(): number {
  return loadCatalogOnce().length;
}

export function catalogErr(): string | null {
  return LOAD_ERR;
}

export function __reloadCatalogForTests__(): void {
  CATALOG = null;
  LOAD_ERR = null;
  loadCatalogOnce();
}