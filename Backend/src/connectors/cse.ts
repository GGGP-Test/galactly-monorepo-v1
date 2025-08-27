// Backend/src/connectors/cse.ts
// Google Programmable Search (CSE) connector
// - Quick search for sanity (/peek)
// - Ingest runner that reads queries from file + env CXs and upserts into lead_pool

import fs from 'fs';
import path from 'path';
import { q } from '../db';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const RESULTS_PER_QUERY = Number(process.env.CSE_RESULTS_PER_QUERY || 5);
const MAX_QUERIES = Number(process.env.CSE_MAX_QUERIES || 30);
const SLEEP_MS = Number(process.env.CSE_SLEEP_MS || 250);

// Env: GOOGLE_CX_MAIN, GOOGLE_CX_LI, GOOGLE_CX_ALT... (any key starting with GOOGLE_CX_)
function envCxList(): string[] {
  return Object.keys(process.env)
    .filter((k) => k.startsWith('GOOGLE_CX_'))
    .map((k) => process.env[k]!)
    .filter(Boolean);
}

function readLinesMaybe(filePath?: string): string[] {
  if (!filePath) return [];
  try {
    const p = path.resolve(filePath);
    const s = fs.readFileSync(p, 'utf8');
    return s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

function host(u: string): string {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}

export type CseItem = {
  source: string; // 'web' | 'linkedin' | 'reddit' | 'x' | 'gov' | 'web'
  title: string;
  url: string;
  snippet?: string;
  displayLink?: string;
  created_at?: string; // best effort
};

function platformFromUrl(u: string): string {
  const h = host(u);
  if (h.includes('linkedin.')) return 'linkedin';
  if (h.includes('reddit.')) return 'reddit';
  if (h.endsWith('.gov')) return 'gov';
  if (h.includes('twitter.') || h.includes('x.com')) return 'x';
  return 'web';
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function cseSearchOnce(qText: string, cx: string): Promise<CseItem[]> {
  if (!GOOGLE_API_KEY || !cx) return [];
  const params = new URLSearchParams({
    key: GOOGLE_API_KEY,
    cx,
    q: qText,
    num: String(Math.max(1, Math.min(10, RESULTS_PER_QUERY))),
    dateRestrict: 'd7', // last 7 days (best effort)
    sort: 'date'
  });
  const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const j: any = await res.json();
  const items: any[] = Array.isArray(j.items) ? j.items : [];
  return items.map((it) => ({
    source: platformFromUrl(it.link || it.url || ''),
    title: it.title || it.link || 'Untitled',
    url: it.link || it.url,
    snippet: it.snippet || '',
    displayLink: it.displayLink || host(it.link || it.url || ''),
    created_at: (it.pagemap && it.pagemap.metatags && it.pagemap.metatags[0]?.['article:published_time']) || undefined
  }));
}

export async function cseQuickPeek(qText: string, prefer: 'main' | 'li' | 'any' = 'any', limit = 5): Promise<CseItem[]> {
  const cxs = envCxList();
  const pick = (want: 'main' | 'li' | 'any'): string => {
    if (want === 'any') return cxs[0];
    const tag = want === 'li' ? 'LI' : 'MAIN';
    const k = Object.keys(process.env).find((n) => n.toUpperCase() === `GOOGLE_CX_${tag}`);
    return (k && process.env[k]) || cxs[0];
  };
  const cx = pick(prefer);
  const out = await cseSearchOnce(qText, cx);
  return out.slice(0, limit);
}

function scoreHeat(it: CseItem): number {
  const t = `${it.title} ${it.snippet || ''}`.toLowerCase();
  let s = 50;
  if (/\brfq\b|\brfp\b|quote|request for (?:quote|proposal)/.test(t)) s += 25;
  if (/looking for|seeking|need|supplier/.test(t)) s += 15;
  if (it.source === 'linkedin' || it.source === 'reddit') s += 10;
  return Math.max(30, Math.min(95, s));
}

export async function ingestFromCse(): Promise<{ inserted: number; scanned: number }> {
  const cxs = envCxList();
  if (!GOOGLE_API_KEY || !cxs.length) return { inserted: 0, scanned: 0 };

  // Queries: from file or fallback
  const queriesFile = process.env.CSE_QUERIES_FILE;
  let queries = readLinesMaybe(queriesFile);
  if (!queries.length) {
    queries = [
      'site:.gov (rfq OR rfp) packaging -sam.gov',
      'site:linkedin.com/posts (looking for OR need) packaging',
      'site:reddit.com (looking for OR need) packaging boxes',
      'packaging corrugated "request for quote"',
    ];
  }
  queries = queries.slice(0, MAX_QUERIES);

  let scanned = 0;
  let inserted = 0;

  for (const qText of queries) {
    for (const cx of cxs) {
      const items = await cseSearchOnce(qText, cx);
      scanned += items.length;
      for (const it of items) {
        const heat = scoreHeat(it);
        const kw = JSON.stringify(qText.split(/\s+/).slice(0, 6));
        try {
          const r = await q(
            `INSERT INTO lead_pool(cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state, created_at)
             VALUES('cse', $1, $2, 60, $3, $4, $5, $6, now() + interval '5 days', 'available', now())
             ON CONFLICT (source_url) DO NOTHING`,
            [kw, it.source, heat, it.url, it.title, it.snippet || null]
          );
          if ((r as any).rowCount > 0) inserted += 1;
        } catch (e) {
          // ignore bad rows
        }
      }
      await sleep(SLEEP_MS);
    }
  }
  return { inserted, scanned };
}
