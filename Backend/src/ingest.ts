// Backend/src/ingest.ts
import fs from 'fs';
import { q } from './db';

const INTENT = [
  'supplier','vendors','procurement','sourcing','vendor registration',
  'become a supplier','purchasing','rfq','rfi','request for quote'
];
const PACKAGING = [
  'packaging','corrugated','carton','cartons','rsc','mailers',
  'labels','pouch','pouches','folding carton','case pack'
];

function readLines(p?: string): string[] {
  if (!p || !fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/g)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(s => s.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,''));
}

function candidates(domain: string): string[] {
  const base = `https://${domain}`;
  const paths = [
    '/', '/suppliers','/supplier','/vendors','/vendor',
    '/vendor-registration','/become-a-supplier','/procurement',
    '/sourcing','/purchasing','/partners','/rfq','/rfi'
  ];
  return paths.map(p => base + p);
}

function hasAny(hay: string, needles: string[]): boolean {
  const h = hay.toLowerCase();
  return needles.some(t => h.includes(t));
}

function score(html: string): {score:number; why:string[]} {
  const why: string[] = [];
  let s = 0;
  for (const t of INTENT) if (html.toLowerCase().includes(t)) { s+=1; why.push(t); }
  let packs = 0;
  for (const t of PACKAGING) if (html.toLowerCase().includes(t)) { packs+=1; why.push(t); }
  s += packs*2;
  return { score: s, why: Array.from(new Set(why)).slice(0, 8) };
}

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Procurement').trim().replace(/\s+/g,' ').slice(0,140);
}

function snippetOf(html: string, hits: string[]): string {
  const lo = html.toLowerCase();
  const pos = hits
    .map(h => lo.indexOf(h.toLowerCase()))
    .filter(i => i >= 0)
    .sort((a,b) => a-b)[0] ?? 0;
  const start = Math.max(0, pos-120);
  const end   = Math.min(html.length, pos+280);
  return html.slice(start,end).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,280);
}

async function fetchHtml(url: string): Promise<string|null> {
  try {
    const ua = process.env.BRANDINTAKE_USERAGENT || 'GalactlyBot/0.1 (+https://galactly.dev)';
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': ua } } as any);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type')||'').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const text = await r.text();
    return text.slice(0, 300_000);
  } catch { return null; }
}

export async function runIngest(source: string) {
  const S = (source || '').toLowerCase();
  if (S && S !== 'brandintake' && S !== 'all') {
    return { ok: true, did: 'skipped', note: `source=${source}` } as const;
  }

  const enabled = process.env.BRANDINTAKE_ENABLED === '1';
  if (!enabled) return { ok: true, did: 'brandintake', checked: 0, created: 0, note: 'disabled' } as const;

  // Use buyers list as the domain seed (your chosen design)
  const file = process.env.BRANDS_FILE || process.env.BUYERS_FILE;
  const domains = readLines(file);
  const MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 40);
  const MAX_URLS    = Number(process.env.BI_MAX_URLS || 200);

  console.log(`[brandintake] starting: domains=${domains.length} maxD=${MAX_DOMAINS} maxU=${MAX_URLS}`);

  let checked = 0, created = 0;
  const seen = new Set<string>();

  outer: for (const d of domains.slice(0, MAX_DOMAINS)) {
    for (const u of candidates(d)) {
      if (seen.has(u)) continue;
      seen.add(u);
      if (seen.size > MAX_URLS) break outer;

      const html = await fetchHtml(u);
      if (!html) { checked++; continue; }

      const { score: sc, why } = score(html);
      if (sc >= 3) {
        const title = titleOf(html);
        const snippet = snippetOf(html, why);
        await q(
          `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat)
           VALUES ('brandintake', $1, $2, $3, 'procurement', $4::text[], $5)
           ON CONFLICT (source_url) DO NOTHING`,
          [u, title, snippet, why, Math.min(95, 60 + sc*5)]
        );
        created++;
      }
      checked++;
    }
  }

  console.log(`[brandintake] done: checked=${checked} created=${created}`);
  return { ok: true, did: 'brandintake', checked, created } as const;
}
