// Backend/src/ingest.ts
// Real brand-intake ingestor (NF-safe, no external APIs)

import fs from 'fs';
import { q } from './db';

type Hit = { url: string; title?: string; snippet?: string; why: string[] };

const PATHS = [
  '/', 'suppliers', 'supplier', 'vendors', 'vendor', 'partners', 'partner',
  'procurement', 'sourcing', 'purchasing', 'become-a-supplier',
  'supplier-registration', 'vendor-registration', 'rfq', 'rfi'
];

const TOK_INTENT = [
  'supplier', 'vendors', 'procurement', 'sourcing', 'rfq', 'rfi',
  'vendor registration', 'supplier registration', 'become a supplier', 'purchasing'
];

const TOK_PACKAGING = [
  'packaging', 'corrugated', 'carton', 'cartons', 'rsc',
  'mailer', 'mailers', 'labels', 'label', 'pouch', 'pouches',
  'folding carton', 'case pack'
];

function readDomainsFromEnvFile(): string[] {
  const p = process.env.BRANDS_FILE || process.env.BUYERS_FILE || '';
  if (!p) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return raw
      .split(/\r?\n/g)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .map(s => s.replace(/^https?:\/\//, '').replace(/\/+.*/, ''))
      .filter(s => s.includes('.'))
      .slice(0, Number(process.env.BI_MAX_DOMAINS || 50));
  } catch {
    return [];
  }
}

function buildCandidates(domain: string): string[] {
  const base = `https://${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  const list: string[] = [];
  for (const p of PATHS) {
    list.push(p === '/' ? base : `${base}/${p}`);
  }
  return list.slice(0, Number(process.env.BI_MAX_URLS || 300));
}

function hasAny(hay: string, needles: string[]) {
  const H = hay.toLowerCase();
  return needles.some(t => H.includes(t));
}

function pickTitle(html: string): string {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Procurement').trim().replace(/\s+/g, ' ').slice(0, 140);
}

function snippetFrom(html: string, why: string[]): string {
  const txt = html.replace(/<[^>]+>/g, ' ');
  let idx = 0;
  for (const w of why) {
    const i = txt.toLowerCase().indexOf(w.toLowerCase());
    if (i >= 0) { idx = i; break; }
  }
  const start = Math.max(0, idx - 120);
  const end = Math.min(txt.length, idx + 240);
  return txt.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 280);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': process.env.BRANDINTAKE_USERAGENT || 'GalactlyBot/0.1 (+https://galactly.dev)' }
    } as any);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    return html.slice(0, 250_000);
  } catch {
    return null;
  }
}

function score(html: string): { ok: boolean; why: string[] } {
  const why: string[] = [];
  for (const t of TOK_INTENT) if (html.toLowerCase().includes(t)) why.push(t);
  let packHits = 0;
  for (const t of TOK_PACKAGING) if (html.toLowerCase().includes(t)) { packHits++; why.push(t); }
  // must have *intent* and at least one packaging token
  const ok = why.some(w => TOK_INTENT.includes(w)) && packHits > 0;
  return { ok, why: Array.from(new Set(why)).slice(0, 6) };
}

export async function runIngest(source: string) {
  const S = (source || '').toLowerCase().trim();
  const allowed = ['brandintake', 'brand-intake', 'buyers', 'brands', 'all'];
  if (!allowed.includes(S)) return { ok: true, did: 'noop' } as const;

  if (process.env.BRANDINTAKE_ENABLED === '0') {
    return { ok: true, did: 'disabled' } as const;
  }

  const domains = readDomainsFromEnvFile();
  if (!domains.length) {
    console.log('[brandintake] no domains (BRANDS_FILE/BUYERS_FILE empty or missing)');
    return { ok: true, did: 'brandintake', checked: 0, created: 0, note: 'no domains' } as const;
  }

  const ttlMin = Number(process.env.BRANDINTAKE_TTL_MIN || 240);
  let checked = 0;
  let created = 0;
  const seen = new Set<string>();

  console.log(`[brandintake] start — domains=${domains.length}`);

  for (const d of domains) {
    for (const u of buildCandidates(d)) {
      if (seen.has(u)) continue;
      seen.add(u);
      checked++;

      const html = await fetchHtml(u);
      if (!html) continue;

      const { ok, why } = score(html);
      if (!ok) continue;

      const title = pickTitle(html);
      const snippet = snippetFrom(html, why);

      try {
        await q(
          `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat, ttl, state)
           VALUES ('brandintake', $1, $2, $3, 'procurement', $4::text[], $5,
                   now() + interval '${ttlMin} minutes', 'available')
           ON CONFLICT (source_url) DO NOTHING`,
          [u, title, snippet, why, 70]
        );
        created++;
      } catch (e) {
        // ignore per-row DB errors, keep going
      }
    }
  }

  console.log(`[brandintake] done — checked=${checked}, created=${created}`);
  return { ok: true, did: 'brandintake', checked, created } as const;
}
