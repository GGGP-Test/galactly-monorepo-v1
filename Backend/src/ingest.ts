// Real brand-intake ingest for Northflank
// Scans buyer domains (BRANDS_FILE) for supplier / vendor / procurement pages,
// prefers pages that mention packaging categories, and inserts into lead_pool.

import fs from 'fs';
import { q } from './db';

const INTENT = [
  'supplier', 'suppliers', 'vendor', 'vendors', 'procurement', 'purchasing',
  'sourcing', 'partner', 'partners', 'vendor registration', 'supplier registration',
  'become a supplier', 'rfq', 'rfi', 'request for quote', 'ariba', 'coupa', 'jaggaer'
];

const PACKAGING = [
  'packaging', 'corrugated', 'carton', 'cartons', 'rsc', 'mailer', 'mailers',
  'labels', 'label', 'pouch', 'pouches', 'folding carton', 'case pack', 'secondary packaging',
  'primary packaging', 'box', 'boxes'
];

const PATHS = [
  '/', '/suppliers', '/supplier', '/vendors', '/vendor', '/partners', '/partner',
  '/procurement', '/purchasing', '/sourcing', '/supply-chain', '/supplychain',
  '/vendor-registration', '/supplier-registration', '/become-a-supplier',
  '/rfq', '/rfi'
];

const SUBS = [
  '', 'suppliers', 'supplier', 'vendors', 'vendor', 'partners',
  'procurement', 'purchasing', 'sourcing'
];

function readDomainsFromFile(p?: string): string[] {
  if (!p || !fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8');
  return raw
    .split(/\r?\n/g)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(s => s.replace(/^https?:\/\//, ''))
    .map(s => s.replace(/\/.+$/, ''))
    .map(s => s.replace(/^www\./, ''))
    .filter(s => s.includes('.'));
}

function buildCandidates(host: string): string[] {
  const urls: string[] = [];
  for (const sub of SUBS) {
    const h = sub ? `${sub}.${host}` : host;
    for (const p of PATHS) urls.push(`https://${h}${p}`);
  }
  return Array.from(new Set(urls));
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'GalactlyBot/0.2 (+https://trygalactly.com)' }
    } as any);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    return html.slice(0, 300_000);
  } catch {
    return null;
  }
}

function score(html: string) {
  const h = html.toLowerCase();
  let s = 0;
  const why: string[] = [];

  for (const t of INTENT) if (h.includes(t)) { s += 1; why.push(t); }
  let pkHits = 0;
  for (const t of PACKAGING) if (h.includes(t)) { pkHits += 1; why.push(t); }
  s += pkHits * 2;

  return { score: s, pkHits, why: Array.from(new Set(why)).slice(0, 8) };
}

function titleOf(html: string) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || '').trim().replace(/\s+/g, ' ').slice(0, 140) || 'Supplier / Procurement';
}

function snippet(html: string, hits: string[]) {
  const text = html.replace(/<[^>]+>/g, ' ');
  if (!hits.length) return text.slice(0, 260).replace(/\s+/g, ' ').trim();
  const idx = hits
    .map(h => text.toLowerCase().indexOf(h.toLowerCase()))
    .filter(i => i >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, idx - 120);
  return text.slice(start, start + 280).replace(/\s+/g, ' ').trim();
}

async function insertLead(url: string, title: string, snip: string, kw: string[], heat: number) {
  await q(
    `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat, state, created_at)
     VALUES ('brandintake', $1, $2, $3, 'supplier-intake', $4::text[], $5, 'available', now())
     ON CONFLICT (source_url) DO NOTHING`,
    [url, title, snip, kw, Math.min(95, Math.max(50, heat))]
  );
}

export async function runIngest(source: string) {
  const S = (source || 'all').toLowerCase();

  if (S !== 'brandintake' && S !== 'all') {
    // keep existing “signals” passthrough behaviour for other sources
    return { ok: true, did: 'noop' } as const;
  }

  const file = process.env.BRANDS_FILE;
  const strict = String(process.env.BI_STRICT || '1') === '1'; // require packaging tokens by default
  const MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 40);
  const MAX_URLS = Number(process.env.BI_MAX_URLS || 200);

  const domains = readDomainsFromFile(file);
  if (!domains.length) {
    return { ok: true, did: 'brandintake', checked: 0, created: 0, note: 'BRANDS_FILE empty/missing' } as const;
  }

  let checked = 0, created = 0;
  const seen = new Set<string>();

  outer:
  for (const host of domains.slice(0, MAX_DOMAINS)) {
    for (const url of buildCandidates(host)) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (seen.size > MAX_URLS) break outer;

      const html = await fetchHtml(url);
      if (!html) { checked++; continue; }

      const { score: s, pkHits, why } = score(html);

      // Thresholds: packaging pages get in easily; otherwise need stronger intent.
      const pass = strict ? (pkHits > 0 && s >= 3) : (s >= 3);
      if (!pass) { checked++; continue; }

      await insertLead(url, titleOf(html), snippet(html, why), why, 60 + s * 5);
      created++; checked++;
    }
  }

  return { ok: true, did: 'brandintake', checked, created } as const;
}
