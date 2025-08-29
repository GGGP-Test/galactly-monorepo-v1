
import fs from 'fs';
import { q } from './db';
import { scanBrandIntake } from './brandintake';

// --- helpers ---------------------------------------------------------------

function readLines(p?: string): string[] {
  if (!p) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return raw
      .split(/\r?\n/g)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .map(s => s.replace(/^https?:\/\//, '')
                 .replace(/^www\./, '')
                 .replace(/\/+.*/, ''));
  } catch {
    return [];
  }
}

function uniq<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}

function enabledFlag(env = process.env): boolean {
  // Default ON if you set BRANDINTAKE_ENABLED=1
  return (env.BRANDINTAKE_ENABLED || '') === '1';
}

// --- main ------------------------------------------------------------------

export async function runIngest(source: string) {
  const S = (source || 'all').toLowerCase();

  if (S !== 'brandintake' && S !== 'all') {
    return { ok: true, did: 'noop' } as const;
  }

  if (!enabledFlag()) {
    return { ok: true, did: 'brandintake', created: 0, checked: 0, note: 'BRANDINTAKE_ENABLED != 1' } as const;
  }

  // Where we read the buyer (brand) domains from
  const file = process.env.BRANDS_FILE || process.env.BUYERS_FILE;
  const domains = uniq(readLines(file)).filter(d => d.includes('.'));

  if (domains.length === 0) {
    return { ok: true, did: 'brandintake', created: 0, checked: 0, note: 'BRANDS_FILE empty/missing' } as const;
  }

  const MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 40);
  const MAX_URLS = Number(process.env.BI_MAX_URLS || 200);
  const TTL_MIN = Number(process.env.BRANDINTAKE_TTL_MIN || 240); // 4h soft TTL

  let created = 0;
  let checked = 0;
  let urlBudget = MAX_URLS;

  for (const domain of domains.slice(0, MAX_DOMAINS)) {
    if (urlBudget <= 0) break;
    try {
      const hits = await scanBrandIntake(domain); // returns [{url,title,snippet}]
      checked++;

      for (const h of hits) {
        if (urlBudget-- <= 0) break;

        await q(
          `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat, ttl, state, created_at)
           VALUES ('brandintake', $1, $2, $3, 'procurement', $4::text[], $5, now() + ($6 || ' minutes')::interval, 'available', now())
           ON CONFLICT (source_url) DO NOTHING`,
          [
            h.url,
            h.title || 'Supplier / Procurement',
            h.snippet || '',
            ['supplier','registration','procurement','sourcing','packaging'],
            80,             // starting heat for explicit intake hits
            String(TTL_MIN)
          ]
        );
        created += 1; // counts attempted inserts; ON CONFLICT leaves created unchanged server-side
      }
    } catch {
      // ignore and continue with next domain
    }
  }

  return { ok: true, did: 'brandintake', checked, created } as const;
}
