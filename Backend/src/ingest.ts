// Backend/src/ingest.ts — fixed brand‑intake ingestor (Northflank friendly)
// Reads BRANDS_FILE (newline‑separated domains), scans likely supplier/procurement URLs,
// and inserts leads into lead_pool. No Google API, no external deps.

import fs from 'fs';
import { q } from './db';
import { scanBrandIntake } from './brandintake';

// safety caps (override via env)
const MAX_DOMAINS = Number(process.env.BI_MAX_DOMAINS || 30);
const MAX_HITS_PER_DOMAIN = Number(process.env.BI_MAX_HITS_PER_DOMAIN || 3);

function readDomainsFromFile(p?: string): string[] {
  if (!p) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return raw
      .split(/\r?\n/g)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .map(s => s.replace(/^https?:\/\//, '').replace(/\/+.*/, '')) // strip scheme + path
      .filter(s => s.includes('.'));
  } catch {
    return [];
  }
}

async function insertHit(url: string, title?: string, snippet?: string, kw: string[] = [], heat = 70) {
  // rely on UNIQUE(source_url) to dedupe
  await q(
    `INSERT INTO lead_pool (platform, source_url, title, snippet, cat, kw, heat)
     VALUES ('brandintake', $1, $2, $3, 'procurement', $4::text[], $5)
     ON CONFLICT (source_url) DO NOTHING`,
    [url, title || null, snippet || null, kw, Math.min(95, Math.max(50, heat))]
  );
}

export async function runIngest(source: string) {
  const S = (source || 'all').toLowerCase();

  // brandintake (real work)
  if (S === 'brandintake' || S === 'all') {
    const file = process.env.BRANDS_FILE; // e.g., /etc/secrets/buyers.txt
    const domains = readDomainsFromFile(file);
    if (!domains.length) return { ok: true, did: 'brandintake', checked: 0, created: 0, note: 'BRANDS_FILE empty/missing' } as const;

    let checked = 0;
    let created = 0;

    for (const domain of domains.slice(0, MAX_DOMAINS)) {
      const hits = await scanBrandIntake(domain);
      const top = hits.slice(0, MAX_HITS_PER_DOMAIN);
      for (const h of top) {
        await insertHit(h.url, h.title, h.snippet, ['supplier','procurement','rfq','packaging']);
        created++;
      }
      checked++;
    }

    return { ok: true, did: 'brandintake', checked, created } as const;
  }

  // signals step (light no‑op placeholder to match your curls)
  if (S === 'signals') {
    // Nothing to derive in this minimal path; UI can still show demo cards until real hits exist.
    return { ok: true, did: 'derive_leads', created: 0 } as const;
  }

  // keep other sources as explicit no‑ops (you removed CSE/RSS)
  if (S === 'cse' || S === 'rss' || S === 'social') {
    return { ok: true, did: 'noop' } as const;
  }

  // unknown source → noop (preserves old behavior)
  return { ok: true, did: 'noop' } as const;
}
