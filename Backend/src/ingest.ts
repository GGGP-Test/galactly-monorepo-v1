// Backend/src/ingest.ts
import fs from 'fs';
import { q } from './db';

/**
 * Why you were only getting DEMO:
 * - A previous stub returned {did:"noop"} on NF.
 * - Requiring packaging tokens made us drop generic "Become a supplier" pages.
 *
 * This version:
 * - Reads BUYERS_FILE (fallback BRANDS_FILE)
 * - Scans common intake/procurement paths
 * - Emits a lead if we see intake intent; boosts heat if packaging words are present
 * - Logs counts so you can verify it ran
 */

const PATHS = [
  '/', 'suppliers', 'supplier', 'vendor', 'vendors', 'partners', 'partner',
  'supplier-portal', 'supplierportal', 'vendor-portal', 'procurement',
  'purchasing', 'sourcing', 'rfq', 'rfi',
  'vendor-registration', 'supplier-registration', 'become-a-supplier',
  'become-a-vendor', 'register-supplier', 'supplier-onboarding',
  'ariba', 'coupa', 'jaggaer', 'sap-ariba', 'suppliernetwork'
];

const TOK_INTENT = [
  'become a supplier','become a vendor','supplier registration','vendor registration',
  'supplier portal','vendor portal','register as a supplier','register supplier',
  'procurement','purchasing','sourcing','rfq','rfi','ariba','coupa','jaggaer','supplier onboarding'
];

const TOK_PACKAGING = [
  'packaging','corrugated','carton','cartons','rsc','mailer','mailers',
  'labels','label','pouch','pouches','folding carton','case pack','secondary packaging',
  'primary packaging','printed box','corrugate'
];

// tiny helpers
function uniq<T>(a: T[]) { return Array.from(new Set(a)); }
function normDomain(s: string) {
  return s.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*/, '');
}

function readDomainsFromFile(p?: string): string[] {
  if (!p || !fs.existsSync(p)) return [];
  return uniq(
    fs.readFileSync(p, 'utf8')
      .split(/\r?\n/g)
      .map(normDomain)
      .filter(Boolean)
  );
}

function candidateUrls(domain: string): string[] {
  const base = `https://${domain}`;
  return uniq(PATHS.map(p => p.startsWith('/') ? base + p : `${base}/${p}`));
}

function containsAny(hay: string, needles: string[]) {
  const h = hay.toLowerCase();
  return needles.some(t => h.includes(t));
}

function scoreHits(html: string) {
  const t = html.toLowerCase();
  const why: string[] = [];
  let score = 0;

  for (const k of TOK_INTENT) if (t.includes(k)) { score += 2; why.push(k); }
  let p = 0;
  for (const k of TOK_PACKAGING) if (t.includes(k)) { p += 1; why.push(k); }
  score += p * 2;

  return { score, why: uniq(why).slice(0, 10), hasPackaging: p > 0 };
}

function pickTitle(html: string) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Procurement').trim().replace(/\s+/g, ' ').slice(0, 140);
}

function pickSnippet(html: string, hits: string[]) {
  const plain = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ');
  if (!hits.length) return plain.slice(0, 280);
  const idx = hits
    .map(h => plain.toLowerCase().indexOf(h.toLowerCase()))
    .filter(i => i >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, idx - 160);
  return plain.slice(start, start + 300);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'GalactlyBot/0.2 (+https://trygalactly.com)' }
    } as any);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    return html.slice(0, 300_000);
  } catch {
    return null;
  }
}

export async function runIngest(source: string) {
  const S = String(source || 'all').toLowerCase();
  if (S !== 'brandintake' && S !== 'all') {
    return { ok: true, did: 'noop' } as const;
  }

  const buyersPath = process.env.BUYERS_FILE;
  const brandsPath = process.env.BRANDS_FILE;
  const domains = readDomainsFromFile(buyersPath) || readDomainsFromFile(brandsPath);
  if (!domains.length) {
    return { ok: true, did: 'brandintake', checked: 0, created: 0, note: 'BUYERS_FILE/BRANDS_FILE empty' } as const;
  }

  const MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 40);
  const MAX_URLS = Number(process.env.BI_MAX_URLS || 200);
  const REQUIRE_PACK = (process.env.BI_REQUIRE_PACKAGING || '0') === '1';

  let checked = 0;
  let created = 0;
  let skipped = 0;

  const seen = new Set<string>();
  const slice = domains.slice(0, MAX_DOMAINS);

  for (const d of slice) {
    for (const url of candidateUrls(d)) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (seen.size > MAX_URLS) break;

      const html = await fetchHtml(url);
      if (!html) { checked++; continue; }

      // Require general intake signals; packaging is a bonus unless BI_REQUIRE_PACKAGING=1
      const { score, why, hasPackaging } = scoreHits(html);
      const hasIntent = containsAny(html, TOK_INTENT);

      if (hasIntent && (!REQUIRE_PACK || hasPackaging)) {
        const title = pickTitle(html);
        const snippet = pickSnippet(html, why);
        const heat = Math.min(95, 55 + score * (hasPackaging ? 3 : 2)); // packaging boosts heat
        try {
          await q(
            `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat)
             VALUES ('brandintake', $1, $2, $3, 'supplier_intake', $4::text[], $5)
             ON CONFLICT (source_url) DO NOTHING`,
            [url, title, snippet, why, heat]
          );
          // check whether we inserted
          const r = await q('SELECT id FROM lead_pool WHERE source_url=$1', [url]);
          if (r.rowCount) created += 1;
        } catch {
          skipped += 1;
        }
      } else {
        skipped += 1;
      }
      checked++;
    }
  }

  // helpful server log so you can see it ran
  console.log(`[brandintake] domains=${slice.length} urlsChecked=${checked} created=${created} skipped=${skipped}`);

  return { ok: true, did: 'brandintake', checked, created, skipped } as const;
}
