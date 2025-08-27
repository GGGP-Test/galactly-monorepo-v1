// =============================
// File: Backend/src/ingest.ts  (updated)
// =============================

import { deriveFromStaticLists } from './signals';

export async function runIngest(source: string) {
  const s = (source || 'all').toLowerCase();
  if (s === 'signals' || s === 'all') {
    const r = await deriveFromStaticLists();
    return { ok: true as const, did: 'derive_from_static_lists', ...r };
  }
  // No‑op for other sources in this minimalist NF build
  return { ok: true as const, did: 'noop' };
}
