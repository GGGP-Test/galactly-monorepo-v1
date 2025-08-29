
import fs from 'fs';
import { q } from './db';

// -------- config via env --------
const BRANDS_FILE = process.env.BRANDS_FILE || '';
const BI_MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 50);
const BI_MAX_URLS = Number(process.env.BI_MAX_URLS || 300);
const TTL_MIN = Number(process.env.BRANDINTAKE_TTL_MIN || 240);
const USER_AGENT =
  process.env.BRANDINTAKE_USERAGENT ||
  'GalactlyBot/0.1 (+https://galactly.dev)';

// Candidate URL paths to probe on each domain
const CANDIDATE_PATHS = [
  '/', // sometimes footer/nav links live here
  '/supplier',
  '/suppliers',
  '/vendor',
  '/vendors',
  '/vendor-registration',
  '/supplier-registration',
  '/become-a-supplier',
  '/procurement',
  '/sourcing',
  '/purchasing',
  '/partners',
  '/partner',
  '/rfq',
  '/rfi',
];

// tokens that imply “we accept/vendors/procurement”
const TOK_INTENT = [
  'supplier',
  'suppliers',
  'vendor',
  'vendors',
  'procurement',
  'sourcing',
  'purchasing',
  'vendor registration',
  'supplier registration',
  'become a supplier',
  'rfq',
  'rfi',
];

// packaging-ish tokens to narrow to our category
const TOK_PACKAGING = [
  'packaging',
  'corrugated',
  'carton',
  'cartons',
  'rsc',
  'mailers',
  'mailer',
  'labels',
  'label',
  'pouch',
  'pouches',
  'folding carton',
  'case pack',
  'box',
  'boxes',
];

// -------- small helpers --------
function nowPlusMinutes(m: number) {
  return new Date(Date.now() + m * 60000).toISOString();
}

function toHost(line: string): string {
  const s = line.trim().toLowerCase();
  if (!s) return '';
  return s
    .replace(/^https?:\/\//, '')
    .replace(/\/.*/, '')
    .replace(/\s+.*/, '');
}

function readDomains(file?: string): string[] {
  if (!file || !fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const out = new Set<string>();
  for (const line of raw.split(/\r?\n/g)) {
    if (!line || line.startsWith('#')) continue;
    const h = toHost(line);
    if (h && h.includes('.')) out.add(h);
  }
  return Array.from(out);
}

function scoreTokens(html: string) {
  const h = html.toLowerCase();
  const hits: string[] = [];
  let score = 0;

  for (const t of TOK_INTENT) {
    if (h.includes(t)) {
      hits.push(t);
      score += 1;
    }
  }
  let p = 0;
  for (const t of TOK_PACKAGING) {
    if (h.includes(t)) {
      hits.push(t);
      p += 1;
    }
  }
  score += p * 2; // packaging matches weigh more
  return { score, kw: Array.from(new Set(hits)).slice(0, 10) };
}

function pickTitle(html: string) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Procurement').trim().replace(/\s+/g, ' ').slice(0, 160);
}

function pickSnippet(html: string, kw: string[]) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  let idx = -1;
  for (const k of kw) {
    const i = text.toLowerCase().indexOf(k.toLowerCase());
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) idx = 0;
  const start = Math.max(0, idx - 160);
  const end = Math.min(text.length, idx + 220);
  return text.slice(start, end).trim();
}

async function fetchHtml(url: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT },
      signal: ctl.signal,
    } as any);
    if (!r.ok) throw new Error(String(r.status));
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) throw new Error('not html');
    const txt = await r.text();
    // limit to keep memory sane
    return txt.slice(0, 300_000);
  } finally {
    clearTimeout(t);
  }
}

// -------- main entry --------
export async function runIngest(source: string) {
  const S = (source || 'all').toLowerCase();
  if (S !== 'brandintake' && S !== 'all') {
    return { ok: true, did: ['noop'] as const };
  }

  const domains = readDomains(BRANDS_FILE);
  if (!domains.length) {
    return {
      ok: true,
      did: ['brandintake'] as const,
      note: 'BRANDS_FILE empty or missing',
      checked: 0,
      created: 0,
    };
  }

  let checked = 0;
  let created = 0;
  const seen = new Set<string>();

  outer: for (const host of domains.slice(0, BI_MAX_DOMAINS)) {
    for (const p of CANDIDATE_PATHS) {
      const url = `https://${host}${p}`;
      if (seen.has(url)) continue;
      seen.add(url);
      if (seen.size > BI_MAX_URLS) break outer;

      try {
        const html = await fetchHtml(url);
        const { score, kw } = scoreTokens(html);
        // threshold: must look like supplier/procurement AND packaging-ish
        if (score >= 3) {
          const title = pickTitle(html);
          const snippet = pickSnippet(html, kw);
          const heat = Math.min(95, 60 + score * 5);

          // lead_pool schema (minimal)
          await q(
            `INSERT INTO lead_pool (cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state)
             VALUES ($1, $2::text[], $3, $4, $5, $6, $7, $8, $9, 'available')
             ON CONFLICT (source_url) DO NOTHING`,
            [
              'procurement',
              kw,
              'brandintake',
              70, // neutral fit; UI re-ranks later
              heat,
              url,
              title,
              snippet,
              nowPlusMinutes(TTL_MIN),
            ]
          );
          // detect if row inserted (no rowCount on SELECT-less insert in pg; do tiny upsert check)
          const row = await q<{ id: number }>(`SELECT id FROM lead_pool WHERE source_url=$1`, [url]);
          if (row.rowCount && row.rowCount > 0) created++;
        }
      } catch {
        // ignore fetch/parse errors; keep moving
      } finally {
        checked++;
      }
    }
  }

  return {
    ok: true,
    did: 'brandintake' as const,
    checked,
    created,
  };
}
