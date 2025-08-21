// Backend/src/connectors/cse.ts
// Google Custom Search JSON API connector
// - Reads queries from env or secret file
// - Supports multiple CXs (one per platform/domain family)
// - Classifies, dedupes by URL, inserts into lead_pool

import axios from 'axios';
import fs from 'fs';
import { db, insertLead } from '../db.js';
import { classify, heatFromSource, fitScore } from '../util.js';

// --------------------------- Config helpers ---------------------------
function readLines(path?: string): string[] {
  if (!path) return [];
  try {
    const raw = fs.readFileSync(path, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readListFromEnvOrFile(envInline: string, envFile: string): string[] {
  const inline = (process.env[envInline] || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const file = readLines(process.env[envFile]);
  // de-dup
  return Array.from(new Set([...inline, ...file]));
}

function envInt(name: string, def: number): number {
  const v = parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(v) ? v : def;
}

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
if (!GOOGLE_API_KEY) {
  console.warn('[cse] GOOGLE_API_KEY not set — connector will no-op');
}

// Known CX env names — set only the ones you created
const CX_ENV_NAMES = [
  'GOOGLE_CX_LINKEDIN',
  'GOOGLE_CX_X',
  'GOOGLE_CX_YOUTUBE',
  'GOOGLE_CX_REDDIT',
  'GOOGLE_CX_WEB',
  'GOOGLE_CX_TRADEWHEEL',
  'GOOGLE_CX_ETSY',
  'GOOGLE_CX_AMAZON',
  'GOOGLE_CX_EBAY',
  'GOOGLE_CX_CRAIGSLIST',
  'GOOGLE_CX_FACEBOOK',
  'GOOGLE_CX_INSTAGRAM',
];

function loadCxMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CX_ENV_NAMES) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

// Queries & bias lists
const BASE_QUERIES = readListFromEnvOrFile('CSE_QUERIES', 'CSE_QUERIES_FILE');
const COMPANY_BIAS = readListFromEnvOrFile('CSE_COMPANY', 'CSE_COMPANY_FILE');
const COMPANY_BIAS_MAX = envInt('CSE_COMPANY_MAX', 50);

// Paging
const NUM_PER_PAGE = Math.min(Math.max(envInt('CSE_NUM_PER_PAGE', 10), 1), 10); // API max 10
const PAGES_PER_QUERY = Math.min(Math.max(envInt('CSE_PAGES_PER_QUERY', 1), 1), 5); // keep sane

// Light intent filter to avoid generic SEO pages
const INTENT_RE = /\b(rfq|request\s+for\s+quote|quote|need|looking\s+for|supplier|recommend|anyone\s+make|who\s+can\s+make)\b/i;

// --------------------------- Utilities ---------------------------
function hostname(href: string): string {
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function platformFromLink(link: string): string {
  const h = hostname(link);
  if (h.includes('linkedin.')) return 'LinkedIn';
  if (h.includes('twitter.') || h === 'x.com' || h.endsWith('.x.com') || h.includes('t.co')) return 'X';
  if (h.includes('youtube.') || h === 'youtu.be') return 'YouTube';
  if (h.includes('reddit.')) return 'Reddit';
  if (h.includes('tradewheel.')) return 'TradeWheel';
  if (h.includes('etsy.')) return 'Etsy';
  if (h.includes('amazon.')) return 'Amazon';
  if (h.includes('ebay.')) return 'eBay';
  if (h.includes('craigslist.')) return 'Craigslist';
  if (h.includes('facebook.')) return 'Facebook';
  if (h.includes('instagram.')) return 'Instagram';
  return 'Web';
}

function baseFitForPlatform(p: string): number {
  switch (p) {
    case 'LinkedIn':
    case 'X':
      return 80;
    case 'TradeWheel':
      return 88;
    case 'Reddit':
      return 76;
    case 'YouTube':
      return 75;
    case 'Craigslist':
      return 78;
    default:
      return 72;
  }
}

function shouldKeep(title: string, snippet: string): boolean {
  const t = `${title} ${snippet}`;
  return INTENT_RE.test(t);
}

function combineQueries(): string[] {
  const base = BASE_QUERIES.length
    ? BASE_QUERIES
    : [
        '"need packaging"',
        '"request for quote" packaging',
        'rfq packaging',
        '"quote for boxes"',
        '"custom boxes" quote',
        '"stand up pouch" quote',
        'labels quote',
        'ispm-15 pallets',
        'packaging supplier',
      ];

  const bias = COMPANY_BIAS.slice(0, COMPANY_BIAS_MAX);
  if (!bias.length) return base;

  const out: string[] = [];
  for (const q of base) {
    out.push(q);
    for (const c of bias) out.push(`${q} ${c}`);
  }
  // de-dup but keep order-ish
  return Array.from(new Set(out));
}

// --------------------------- Core call ---------------------------
async function cseRequest(cx: string, q: string, start: number): Promise<any[]> {
  const url = 'https://www.googleapis.com/customsearch/v1';
  const params = { key: GOOGLE_API_KEY, cx, q, num: NUM_PER_PAGE, start } as any;
  const { data } = await axios.get(url, { params, timeout: 15000 });
  const items = (data && data.items) || [];
  return Array.isArray(items) ? items : [];
}

async function processItem(item: any) {
  try {
    const link: string = (item.link || '').trim();
    if (!link) return;
    const title: string = item.title || '';
    const snippet: string = item.snippet || '';

    if (!shouldKeep(title, snippet)) return; // light intent gate

    // dedupe (3-day window)
    const exists = db
      .prepare('SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?')
      .get(link, Date.now() - 3 * 24 * 3600 * 1000);
    if (exists) return;

    const { cat, kw } = classify(`${title} ${snippet}`);
    const platform = platformFromLink(link);
    const fit_user = fitScore(baseFitForPlatform(platform));
    const fit_competition = fitScore(fit_user + 3);

    const lead = {
      cat,
      kw,
      platform,
      region: 'US' as const, // heuristic (most buyers you target); can improve later
      fit_user,
      fit_competition,
      heat: heatFromSource(link),
      source_url: link,
      evidence_snippet: snippet.slice(0, 180),
      generated_at: Date.now(),
      expires_at: Date.now() + 72 * 3600 * 1000,
      state: 'available' as const,
      reserved_by: null,
      reserved_until: null,
      company: null,
      person_handle: null,
      contact_email: null,
    };

    insertLead(lead as any);
  } catch (_e) {
    // ignore individual item failures
  }
}

// --------------------------- Public API ---------------------------
export async function pollCSE(): Promise<number> {
  if (!GOOGLE_API_KEY) return 0;

  const cxMap = loadCxMap();
  const queries = combineQueries();
  if (!Object.keys(cxMap).length || !queries.length) return 0;

  let inserted = 0;
  for (const [envName, cx] of Object.entries(cxMap)) {
    // Process a modest slice per run to stay under quotas
    for (const q of queries) {
      for (let page = 0; page < PAGES_PER_QUERY; page++) {
        const start = page * NUM_PER_PAGE + 1; // 1-based
        try {
          const items = await cseRequest(cx, q, start);
          for (const it of items) {
            const before = db.prepare('SELECT COUNT(*) as n FROM lead_pool').get() as any;
            await processItem(it);
            const after = db.prepare('SELECT COUNT(*) as n FROM lead_pool').get() as any;
            if (after.n > before.n) inserted++;
          }
        } catch (e: any) {
          // If a CX is exhausted or restricted, move on quietly
          break;
        }
      }
    }
  }
  return inserted;
}

export default { pollCSE };
