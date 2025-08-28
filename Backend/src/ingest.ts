// Backend/src/ingest.ts
import fs from 'fs';
import path from 'path';
import { q } from './db';

type Lead = {
  platform: string;
  source_url: string;
  title: string;
  snippet: string;
  heat: number;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function readLines(p: string): string[] {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return raw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !s.startsWith('#'));
  } catch {
    return [];
  }
}

function toOrigins(line: string): string[] {
  // accept: domain.com | http(s)://domain.com
  const norm = line
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!norm) return [];
  return [`https://${norm}`, `http://${norm}`];
}

const CANDIDATE_PATHS = [
  '/', // cheap first touch (may hint in footer/nav)
  '/suppliers',
  '/supplier',
  '/vendors',
  '/vendor',
  '/become-a-supplier',
  '/become-a-vendor',
  '/procurement',
  '/sourcing',
  '/rfq',
  '/rfi',
  '/vendor-registration',
  '/supplier-registration'
];

const TOKENS_VENDOR = /(supplier|vendor|procurement|sourcing|rfq|rfi|registration)/i;
const TOKENS_PACK  = /(packag(ing|e)|corrugated|carton|labels?|pouch|mailers?|boxes?)/i;

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text') && !ct.includes('html')) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function summarize(html: string): { title: string; snippet: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]{0,140})<\/title>/i);
  const title = (titleMatch?.[1] || 'Supplier / procurement').trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = text.match(
    /(supplier|vendor|procurement|sourcing|rfq|rfi|registration)[^\.!?]{0,220}/i
  );
  const snippet = (m ? m[0] : text.slice(0, 220)).trim();
  return { title, snippet };
}

async function insertLead(L: Lead) {
  await q(
    `INSERT INTO lead_pool (platform, source_url, title, snippet, heat, cat, kw, created_at, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), 'available')
     ON CONFLICT (source_url) DO NOTHING`,
    [
      L.platform,
      L.source_url,
      L.title,
      L.snippet,
      L.heat,
      'brandintake',
      ['supplier', 'packaging']
    ]
  );
}

async function scanOrigin(origin: string, timeoutMs: number) {
  const found: Lead[] = [];
  for (const p of CANDIDATE_PATHS) {
    const url = origin + p;
    const html = await fetchText(url, timeoutMs);
    if (!html) continue;
    if (TOKENS_VENDOR.test(html) && TOKENS_PACK.test(html)) {
      const { title, snippet } = summarize(html);
      found.push({
        platform: 'brandintake',
        source_url: url,
        title,
        snippet,
        heat: 80
      });
    }
    // Be gentle
    await sleep(120);
  }
  for (const L of found) await insertLead(L);
  return found.length;
}

async function runBrandIntake() {
  const file =
    process.env.BRANDS_FILE ||
    process.env.BUYERS_FILE ||
    '/etc/secrets/buyers.txt';
  const limit = Number(process.env.BRANDINTAKE_LIMIT || '40'); // per run
  const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS || '6000');

  const lines = readLines(file);
  if (!lines.length) {
    return { ok: true, did: 'noop-no-brands', scanned: 0, inserted: 0 };
  }

  // Simple rotation window (optional): pick a slice based on minute
  const start = 0;
  const slice = lines.slice(start, Math.min(lines.length, start + limit));

  let scanned = 0;
  let inserted = 0;

  for (const line of slice) {
    const origins = toOrigins(line);
    for (const o of origins) {
      try {
        const n = await scanOrigin(o, timeoutMs);
        scanned += 1;
        inserted += n;
        if (inserted >= 25) break; // soft cap per run
      } catch {
        // ignore
      }
    }
    if (inserted >= 25) break;
  }
  return { ok: true, did: 'brandintake', scanned, inserted };
}

async function deriveLeads() {
  // cheap maintenance hook; extend later (decay, TTL, etc.)
  // For now, just report counts so the admin call has feedback.
  const c = await q(
    `SELECT COUNT(*)::int AS n FROM lead_pool WHERE state='available'`
  );
  const n = (c.rows[0]?.n as number) || 0;
  return { ok: true, did: 'derive_leads', created: 0, pool: n };
}

export async function runIngest(source: string) {
  switch ((source || 'brandintake').toLowerCase()) {
    case 'brandintake':
      return runBrandIntake();
    case 'signals':
      return deriveLeads();
    case 'cse':
    case 'rss':
      return { ok: true, did: 'noop' as const };
    case 'all':
      // only the pieces that match your strategy
      const a = await runBrandIntake();
      const b = await deriveLeads();
      return { ok: true, steps: [a, b] };
    default:
      return { ok: true, did: 'noop-unknown-source', source };
  }
}
