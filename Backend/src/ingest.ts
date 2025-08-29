// Backend/src/ingest.ts
import fs from 'fs';
import { q } from './db';

const UA = process.env.BRANDINTAKE_USERAGENT || 'GalactlyBot/0.1 (+https://trygalactly.com)';

// Pages we’ll try under each buyer domain
const CANDIDATE_PATHS = [
  '/', 'suppliers', 'supplier', 'vendor', 'vendors', 'partners', 'partner',
  'procurement', 'purchasing', 'sourcing',
  'become-a-supplier', 'become-a-vendor', 'supplier-registration', 'vendor-registration',
  'rfq', 'rfi', 'request-for-quote'
];

// Signals
const TOK_INTENT = [
  'become a supplier', 'become a vendor', 'supplier registration', 'vendor registration',
  'procurement', 'purchasing', 'sourcing', 'rfq', 'rfi', 'request for quote'
];

const TOK_PACKAGING = [
  'packaging', 'corrugated', 'carton', 'cartons', 'rsc', 'case pack',
  'mailer', 'mailers', 'label', 'labels', 'pouch', 'pouches', 'folding carton'
];

// ---------------- helpers ----------------
function readDomainsFromFile(p?: string): string[] {
  if (!p || !fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/g)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(s => s.replace(/^https?:\/\//, '').replace(/\/+.*/, '')) // keep host only
    .filter(s => s.includes('.'));
}

function candidateUrls(host: string): string[] {
  const base = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return CANDIDATE_PATHS.map(p => `https://${base}/${p}`);
}

function includesAny(hay: string, needles: string[]) {
  const h = hay.toLowerCase();
  return needles.some(t => h.includes(t));
}

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Procurement').trim().replace(/\s+/g, ' ').slice(0, 140);
}

function snippetFrom(html: string, hits: string[]): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!hits.length) return text.slice(0, 260);
  const lo = text.toLowerCase();
  const idx = hits
    .map(h => lo.indexOf(h.toLowerCase()))
    .filter(i => i >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, idx - 120);
  const end = Math.min(text.length, idx + 240);
  return text.slice(start, end);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA } } as any);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    return html.slice(0, 250_000);
  } catch {
    return null;
  }
}

// ---------------- main ----------------
export async function runIngest(_source?: string) {
  // Always run brand-intake; no more "noop" paths.
  const file = process.env.BUYERS_FILE || process.env.BRANDS_FILE;
  const domains = readDomainsFromFile(file);
  if (!domains.length) {
    console.warn('[brandintake] buyers list empty. Set BUYERS_FILE or BRANDS_FILE.');
    return { ok: true, did: 'brandintake', checked: 0, created: 0, note: 'no buyers' } as const;
  }

  const MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 50);
  const MAX_URLS = Number(process.env.BI_MAX_URLS || 300);

  let checked = 0;
  let created = 0;
  const seen = new Set<string>();

  console.log(`[brandintake] starting. domains=${domains.length} (cap=${MAX_DOMAINS}), maxUrls=${MAX_URLS}, file=${file}`);

  outer: for (const host of domains.slice(0, MAX_DOMAINS)) {
    for (const url of candidateUrls(host)) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (seen.size > MAX_URLS) break outer;

      const html = await fetchHtml(url);
      checked++;
      if (!html) continue;

      const hasIntent = includesAny(html, TOK_INTENT);
      const hasPack = includesAny(html, TOK_PACKAGING);

      if (!hasIntent && !hasPack) continue;

      // Score: intent(2) + packaging(3). Require at least intent, add heat if packaging too.
      const score = (hasIntent ? 2 : 0) + (hasPack ? 3 : 0);
      const heat = Math.min(95, 55 + score * 8);
      const why = [
        ...(hasIntent ? ['intent'] : []),
        ...(hasPack ? ['packaging'] : [])
      ];

      const title = titleOf(html);
      const snippet = snippetFrom(html, hasPack ? TOK_PACKAGING : TOK_INTENT);

      try {
        await q(
          `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat, created_at)
           VALUES ('brandintake', $1, $2, $3, 'procurement', $4::text[], $5, now())
           ON CONFLICT (source_url) DO NOTHING`,
          [url, title, snippet, why, heat]
        );
        created++;
      } catch (e) {
        // ignore dup or minor DB issues so the loop continues
      }
    }
  }

  console.log(`[brandintake] done. checked=${checked} created=${created}`);
  return { ok: true, did: 'brandintake', checked, created } as const;
}
