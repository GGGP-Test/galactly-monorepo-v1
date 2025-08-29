// Backend/src/ingest.ts
import fs from 'fs';
import { q } from './db';

const TOK_INTENT = [
  'supplier', 'vendors', 'procurement', 'sourcing', 'rfq', 'rfi',
  'vendor registration', 'become a supplier', 'purchasing'
];

const TOK_PACKAGING = [
  'packaging', 'corrugated', 'carton', 'cartons', 'rsc',
  'mailer', 'labels', 'pouch', 'pouches', 'folding carton', 'case pack'
];

// very small timeout helper
async function withTimeout<T>(p: Promise<T>, ms=10000): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms))
  ]);
}

function readDomainsFromFile(p?: string): string[] {
  if (!p || !fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8');
  return raw
    .split(/\r?\n/g)
    .map(s => s.trim().toLowerCase())
    .filter(s => !!s && !s.startsWith('#'))
    .map(s => s.replace(/^https?:\/\//, '').replace(/\/+.*/, ''))
    .filter(s => s.includes('.'));
}

function candidatesFor(domain: string): string[] {
  const base = `https://${domain}`;
  const paths = [
    '/', '/suppliers', '/supplier', '/vendors', '/vendor',
    '/vendor-registration', '/become-a-supplier', '/procurement',
    '/sourcing', '/purchasing', '/partners', '/rfq', '/rfi'
  ];
  return paths.map(p => base + p);
}

function scoreTextForSignals(html: string): { score: number; why: string[] } {
  const txt = html.toLowerCase();
  const why: string[] = [];
  let s = 0;
  for (const t of TOK_INTENT) if (txt.includes(t)) { s += 1; why.push(t); }
  // packaging tokens give us stronger signal this is OUR category
  let pHits = 0;
  for (const t of TOK_PACKAGING) if (txt.includes(t)) { pHits += 1; why.push(t); }
  s += pHits * 2;
  return { score: s, why: Array.from(new Set(why)).slice(0, 6) };
}

function pickTitle(html: string): string {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Procurement').trim().replace(/\s+/g, ' ').slice(0, 140);
}

function snippetFrom(html: string, hits: string[]): string {
  if (!hits.length) return '';
  const idx = hits
    .map(h => html.toLowerCase().indexOf(h.toLowerCase()))
    .filter(i => i >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, idx - 120);
  const end = Math.min(html.length, idx + 240);
  return html.slice(start, end).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
}

async function fetchText(url: string): Promise<string> {
  // Node 20 has global fetch; typings aren’t necessary here
  const res = await withTimeout(fetch(url, {
    method: 'GET',
    headers: { 'user-agent': 'GalactlyBot/1.0 (+https://trygalactly.com)' }
  }) as any, 12000) as Response;

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) {
    // non-html pages aren’t useful; bail
    throw new Error(`not html: ${ct}`);
  }
  const text = await res.text();
  return text;
}

export async function runIngest(source: string) {
  const S = (source || 'all').toLowerCase();
  if (S !== 'brandintake' && S !== 'all') return { ok: true, did: 'noop' } as const;

  const file = process.env.BRANDS_FILE;
  const domains = readDomainsFromFile(file);
  if (!domains.length) return { ok: true, did: 'brandintake', checked: 0, created: 0, note: 'BRANDS_FILE empty/missing' } as const;

  // small safety limits for free tier
  const MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 30);
  const MAX_URLS = Number(process.env.BI_MAX_URLS || 120);

  let checked = 0;
  let created = 0;
  const seen = new Set<string>();

  outer: for (const d of domains.slice(0, MAX_DOMAINS)) {
    for (const url of candidatesFor(d)) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (seen.size > MAX_URLS) break outer;

      try {
        const html = await fetchText(url);
        const { score, why } = scoreTextForSignals(html);
        if (score >= 3) {
          const title = pickTitle(html);
          const snippet = snippetFrom(html, why);
          // rely on UNIQUE(source_url) to dedupe
          await q(
            `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat)
             VALUES ('brandintake', $1, $2, $3, 'procurement', $4::text[], $5)
             ON CONFLICT (source_url) DO NOTHING`,
            [url, title, snippet, why, Math.min(95, 60 + score * 5)]
          );
          created++;
        }
      } catch {
        // ignore fetch/parse errors; move on
      } finally {
        checked++;
      }
    }
  }

  return { ok: true, did: 'brandintake', checked, created } as const;
}
