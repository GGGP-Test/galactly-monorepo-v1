
import fs from 'fs';
import { q } from './db';

const UA = process.env.BRANDINTAKE_USERAGENT || 'GalactlyBot/0.1 (+https://trygalactly.com)';
const BRANDS_FILE = process.env.BRANDS_FILE || process.env.BUYERS_FILE || '/etc/secrets/buyers.txt';

const BI_MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 50);
const BI_MAX_URLS    = Number(process.env.BI_MAX_URLS    || 300);
const BI_CONCURRENCY = Math.max(1, Number(process.env.BI_CONCURRENCY || 4));
const TIMEOUT_MS     = Number(process.env.BI_TIMEOUT_MS   || 12000);

const CANDIDATE_PATHS = [
  '', 'supplier', 'suppliers', 'vendor', 'vendors',
  'procurement', 'sourcing', 'purchasing', 'partners',
  'become-a-supplier', 'vendor-registration', 'supplier-registration',
  'rfq', 'rfi', 'request-for-quote'
];

const TOK_INTENT = [
  'become a supplier','vendor registration','supplier registration',
  'procurement','purchasing','sourcing','rfq','rfi','request for quote'
];

const TOK_PACKAGING = [
  'packaging','corrugated','carton','cartons','rsc','mailers','mailer',
  'labels','pouch','pouches','folding carton','case pack'
];

// ---------- helpers ----------
function readDomains(file?: string): string[] {
  const p = file && fs.existsSync(file) ? file : '';
  if (!p) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/g)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(s => s.replace(/^https?:\/\//,'').replace(/\/+$/,''))
    .filter(s => s.includes('.'));
}

function urlsFor(domain: string): string[] {
  const base = `https://${domain}`;
  return CANDIDATE_PATHS.map(p => p ? `${base}/${p}` : base);
}

function hasAny(hay: string, needles: string[]): {hits:string[], count:number} {
  const text = hay.toLowerCase();
  const hits = Array.from(new Set(needles.filter(t => text.includes(t))));
  return { hits, count: hits.length };
}

function pickTitle(html: string): string {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Procurement').trim().replace(/\s+/g,' ').slice(0,140);
}

function snippetFrom(html: string, needles: string[]): string {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ');
  const text  = clean.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  const lower = text.toLowerCase();
  let idx = -1;
  for (const n of needles) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0 && (idx === -1 || i < idx)) idx = i;
  }
  const start = Math.max(0, idx === -1 ? 0 : idx - 120);
  const end   = Math.min(text.length, start + 260);
  return text.slice(start, end).trim();
}

function score(intentHits: number, packagingHits: number): number {
  // Light heuristic: packaging tokens weigh more (category fit).
  const s = 40 + intentHits * 5 + packagingHits * 10;
  return Math.max(45, Math.min(95, s));
}

async function fetchHtml(url: string): Promise<string|null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } } as any);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    return html.length > 400_000 ? html.slice(0, 400_000) : html;
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function insertLead(url: string, title: string, snippet: string, kw: string[], heat: number) {
  await q(
    `INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet)
     VALUES ('procurement', $1::text[], 'brandintake', $2, $3, $4, $5)
     ON CONFLICT (source_url) DO NOTHING`,
    [kw, heat, url, title, snippet]
  );
}

// ---------- main ----------
export async function runBrandIntake(): Promise<{ ok:true; did:'brandintake'; checked:number; created:number; errors:number; }> {
  const domains = readDomains(BRANDS_FILE).slice(0, BI_MAX_DOMAINS);
  if (!domains.length) return { ok:true, did:'brandintake', checked:0, created:0, errors:0 };

  let checked = 0, created = 0, errors = 0;
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const d of domains) {
    for (const u of urlsFor(d)) {
      if (!seen.has(u)) { seen.add(u); queue.push(u); }
      if (queue.length >= BI_MAX_URLS) break;
    }
    if (queue.length >= BI_MAX_URLS) break;
  }

  // tiny concurrency runner
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const idx = i++; const url = queue[idx];
      try {
        const html = await fetchHtml(url);
        if (html) {
          const intent = hasAny(html, TOK_INTENT);
          const pack   = hasAny(html, TOK_PACKAGING);
          if (intent.count >= 1 && pack.count >= 1) {
            const title   = pickTitle(html);
            const snippet = snippetFrom(html, [...intent.hits, ...pack.hits]);
            const heat    = score(intent.count, pack.count);
            await insertLead(url, title, snippet, [...new Set([...intent.hits, ...pack.hits])].slice(0, 8), heat);
            created++;
          }
        }
      } catch { errors++; }
      finally { checked++; }
    }
  }

  const workers = Array.from({ length: BI_CONCURRENCY }, worker);
  await Promise.all(workers);

  return { ok:true, did:'brandintake', checked, created, errors };
}
