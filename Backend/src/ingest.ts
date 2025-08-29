// Backend/src/ingest.ts  — real brand intake (no external APIs)
import fs from 'fs';
import { q } from './db';

const TOK_INTENT = [
  'supplier','vendors','procurement','sourcing','rfq','rfi',
  'vendor registration','become a supplier','purchasing','supplier registration'
];

const TOK_PACKAGING = [
  'packaging','corrugated','carton','cartons','rsc','mailer',
  'labels','pouch','pouches','folding carton','case pack'
];

function cleanDomainsFile(p?: string): string[] {
  if (!p || !fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/g)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(s => s.replace(/^https?:\/\//, ''))
    .map(s => s.replace(/\/+.*/, ''))
    .map(s => s.replace(/^www\./, ''))
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

function score(html: string) {
  const t = html.toLowerCase();
  let s = 0; const why: string[] = [];
  for (const k of TOK_INTENT) if (t.includes(k)) { s += 1; why.push(k); }
  let pk = 0;
  for (const k of TOK_PACKAGING) if (t.includes(k)) { pk += 1; why.push(k); }
  s += pk * 2;
  return { s, why: Array.from(new Set(why)).slice(0, 8) };
}

function titleOf(html: string) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Procurement').trim().replace(/\s+/g,' ').slice(0,140);
}

function snippet(html: string, needles: string[]) {
  const plain = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
  const text = plain.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  const idx = needles
    .map(k => text.toLowerCase().indexOf(k.toLowerCase()))
    .filter(i => i >= 0).sort((a,b)=>a-b)[0] ?? 0;
  const start = Math.max(0, idx - 120);
  return text.slice(start, start + 280);
}

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': process.env.BRANDINTAKE_USERAGENT || 'GalactlyBot/0.1 (+https://galactly.dev)' }
  } as any);
  if (!r.ok) throw new Error(String(r.status));
  const ct = (r.headers.get('content-type')||'').toLowerCase();
  if (!ct.includes('text/html')) throw new Error('not-html');
  const html = await r.text();
  return html.slice(0, 250_000);
}

export async function runIngest(source: string) {
  const S = (source || 'all').toLowerCase();
  if (S !== 'brandintake' && S !== 'all') return { ok: true, did: 'noop' } as const;
  if (String(process.env.BRANDINTAKE_ENABLED || '1') !== '1')
    return { ok: true, did: 'brandintake', note: 'disabled' } as const;

  const domains = cleanDomainsFile(process.env.BUYERS_FILE || process.env.BRANDS_FILE);
  const MAX_D = Number(process.env.BI_MAX_DOMAINS || 30);
  const MAX_U = Number(process.env.BI_MAX_URLS || 120);

  let checked = 0, created = 0;
  const seen = new Set<string>();

  outer: for (const d of domains.slice(0, MAX_D)) {
    for (const url of candidatesFor(d)) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (seen.size > MAX_U) break outer;
      try {
        const html = await fetchHtml(url);
        const { s, why } = score(html);
        if (s >= 3) {
          const title = titleOf(html);
          const snip = snippet(html, why);
          await q(
            `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat)
             VALUES ('brandintake', $1, $2, $3, 'procurement', $4::text[], $5)
             ON CONFLICT (source_url) DO NOTHING`,
            [url, title, snip, why, Math.min(96, 60 + s * 5)]
          );
          created++;
        }
      } catch { /* ignore */ }
      finally { checked++; }
    }
  }

  return { ok: true, did: 'brandintake', checked, created } as const;
}
