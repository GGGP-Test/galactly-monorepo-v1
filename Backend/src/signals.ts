// =============================
// File: Backend/src/signals.ts
// Purpose: create lead_pool rows from static BUYERS_FILE (and optionally VENDORS_FILE)
// Strategy (v1):
//  - Read newline‑separated domains from BUYERS_FILE
//  - Normalize to bare host (no http/https, no trailing slashes)
//  - Insert WARM "brand candidate" leads (source_url = https://<host>/)
//  - ON CONFLICT DO NOTHING (dedupe by source_url)
//  - Limit per run via env SEED_LIMIT (default 500)
// =============================

import fs from 'fs';
import path from 'path';
import { q } from './db';

function readLines(p?: string): string[] {
  if (!p) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return raw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^https?:\/\//i, ''))
      .map(s => s.replace(/\/(.*)$/,'')).map(s=>s.replace(/#.*/,''))
      .map(s => s.toLowerCase())
      .filter(s => /[a-z0-9.-]+\.[a-z]{2,}/.test(s));
  } catch {
    return [];
  }
}

export async function deriveFromStaticLists() {
  const buyersPath = process.env.BUYERS_FILE || '/etc/secrets/buyers.txt';
  const vendorsPath = process.env.VENDORS_FILE || '/etc/secrets/vendors.txt';
  const MAX = Number(process.env.SEED_LIMIT || 500);

  const buyers = Array.from(new Set(readLines(buyersPath))).slice(0, MAX);
  const vendors = Array.from(new Set(readLines(vendorsPath))); // not used in v1 scoring yet

  if (!buyers.length) {
    return { ok: false as const, reason: 'NO_BUYERS' };
  }

  // Build parameterized bulk insert
  const values: string[] = [];
  const params: any[] = [];
  let i = 1;
  for (const host of buyers) {
    const url = `https://${host}/`;
    const title = `Potential buyer: ${host}`;
    const snippet = vendors.length
      ? `Candidate buyer domain. Matched to ${vendors.length} vendor profiles (v1 static).`
      : `Candidate buyer domain. Awaiting signals/enrichment.`;
    values.push(
      `('buyer', ARRAY['buyer'], 'web', 60, 65, $${i++}, $${i++}, $${i++}, now() + interval '2 days', 'available', now())`
    );
    params.push(url, title, snippet);
  }

  const sql = `INSERT INTO lead_pool
    (cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state, created_at)
    VALUES ${values.join(',')}
    ON CONFLICT (source_url) DO NOTHING`;

  const r = await q(sql, params);
  const inserted = (r as any).rowCount ?? 0;
  return { ok: true as const, inserted, considered: buyers.length };
}

