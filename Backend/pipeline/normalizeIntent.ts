// File: src/pipeline/normalizeIntent.ts
// Purpose: Normalize intent, extract evidence phrases, and backfill posted_at for recent leads.
// Usage: import { normalizeIntentRecent } from './pipeline/normalizeIntent.js';
//        await normalizeIntentRecent(72); // process last 72h
// Notes: Safe to run repeatedly; only updates rows that need it.

import { db } from '../db.js';

const DAY = 24 * 3600 * 1000;

function ensureSchema() {
  const cols = new Set<string>();
  const rs = db.prepare(`PRAGMA table_info(lead_pool)`).all() as Array<{ name: string }>;
  for (const r of rs) cols.add(r.name);
  const add = (name: string, sqlType: string) => {
    if (!cols.has(name)) db.prepare(`ALTER TABLE lead_pool ADD COLUMN ${name} ${sqlType}`).run();
  };
  add('intent_type', 'TEXT');
  add('intent_phrases_json', 'TEXT');
  add('posted_at', 'INTEGER');
  add('lead_score', 'INTEGER');
  add('source', 'TEXT');
  add('tags_json', 'TEXT');
}

// Phrase lattice
const HOT_RE = /\b(rfq|rfp|request for (?:quote|proposal)|tender|solicitation|bid)\b|\bqty\s*[:=]?\s*\d{2,}|\bmoq\b|due\s+\d{1,2}[\/\-.]\d{1,2}/gi;
const WARM_RE = /(looking for (?:a\s+)?supplier|quote for|seeking (?:quotes|supplier)|anyone (?:can )?make|need (?:custom )?(?:boxes|labels|pouches|packaging))/gi;

function collect(text: string): string[] {
  const bag: string[] = [];
  const txt = String(text || '');
  for (const re of [HOT_RE, WARM_RE]) {
    const m = txt.match(re);
    if (m) bag.push(...m);
  }
  return [...new Set(bag)].slice(0, 12);
}

function classifyIntent(text: string): 'HOT' | 'WARM' | 'OK' {
  const t = String(text || '').toLowerCase();
  if (HOT_RE.test(t)) return 'HOT';
  if (WARM_RE.test(t)) return 'WARM';
  return 'OK';
}

function parsePostedFromEvidence(ev?: string, gen?: number): number {
  if (!ev) return gen || Date.now();
  // Try patterns like "posted=YYYY-MM-DD" or explicit dates in evidence
  const m1 = ev.match(/posted\s*=\s*(\d{4}-\d{2}-\d{2})/i);
  if (m1) {
    const t = Date.parse(m1[1]);
    if (!Number.isNaN(t)) return t;
  }
  const m2 = ev.match(/(\d{4}-\d{2}-\d{2})/);
  if (m2) {
    const t = Date.parse(m2[1]);
    if (!Number.isNaN(t)) return t;
  }
  return gen || Date.now();
}

export function normalizeIntentRecent(hours = 72) {
  ensureSchema();
  const since = Date.now() - hours * 3600 * 1000;
  const rows = db.prepare(
    `SELECT id, platform, evidence_snippet, generated_at, intent_type, intent_phrases_json, posted_at
     FROM lead_pool
     WHERE generated_at > ? AND (intent_type IS NULL OR intent_phrases_json IS NULL OR posted_at IS NULL)`
  ).all(since) as Array<{
    id: number; platform: string; evidence_snippet: string | null; generated_at: number;
    intent_type: string | null; intent_phrases_json: string | null; posted_at: number | null;
  }>;

  const upd = db.prepare(
    `UPDATE lead_pool SET intent_type=?, intent_phrases_json=?, posted_at=? WHERE id=?`
  );

  let n = 0;
  for (const r of rows) {
    const ev = r.evidence_snippet || '';
    const phrases = collect(ev);
    const intent = classifyIntent(ev);
    const posted = r.posted_at && r.posted_at > 0 ? r.posted_at : parsePostedFromEvidence(ev, r.generated_at);
    upd.run(intent, JSON.stringify(phrases), posted, r.id);
    n++;
  }
  return { ok: true, updated: n, scanned: rows.length };
}

// Convenience: normalize last 7 days
export function normalizeLast7Days() {
  return normalizeIntentRecent(24 * 7);
}
