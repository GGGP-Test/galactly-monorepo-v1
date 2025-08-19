// File: src/pipeline/score.ts
// Purpose: Compute and persist a single numeric lead_score (0–99) for each lead, based on
//          intent strength, recency (half‑life), source quality, region fit and evidence detail.
// Usage:   import { scoreRecent } from './pipeline/score.js';
//          await scoreRecent(72); // score leads generated in the last 72h
// Notes:   Idempotent; safe to run often. Requires columns created by normalizeIntent.

import { db } from '../db.js';

function ensureSchema(){
  const cols = new Set<string>();
  const rs = db.prepare('PRAGMA table_info(lead_pool)').all() as Array<{ name: string }>;
  for(const r of rs) cols.add(r.name);
  const add = (name: string, sqlType: string) => { if(!cols.has(name)) db.prepare(`ALTER TABLE lead_pool ADD COLUMN ${name} ${sqlType}`).run(); };
  add('intent_type', 'TEXT');
  add('posted_at', 'INTEGER');
  add('lead_score', 'INTEGER');
}

// Tunables
const INTENT_WEIGHT: Record<string, number> = { HOT: 42, WARM: 26, OK: 12 };
const REGION_WEIGHT: Record<string, number> = { US: 4, Canada: 4, Other: 0 };
const HALF_LIFE_HOURS = 24 * 7; // 7 days

function lc(s: any){ return String(s || '').toLowerCase(); }

function recencyBoost(postedAt: number){
  const now = Date.now();
  const ageH = Math.max(0, (now - (postedAt || now)) / 3600000);
  const decay = Math.pow(0.5, ageH / HALF_LIFE_HOURS); // 1.0 down to ~0
  return Math.round(30 * decay); // cap recency influence to 30
}

function sourceBoost(platform: string){
  const p = lc(platform);
  if(p.includes('sam.gov')) return 10;
  if(p.includes('webz.io')) return 7;
  if(p.includes('googlenews') || p.includes('google alerts')) return 6;
  if(p.includes('rssapp') || p.includes('rss-bridge') || p.includes('rss')) return 6;
  if(p.includes('reddit')) return 6;
  if(p.includes('twitter') || p === 'x' || p.includes(' x')) return 6;
  if(p.includes('tradewheel')) return 8;
  if(p.includes('craigslist')) return 5;
  return 4;
}

function hasDigit(s: string){ for(const ch of s){ if(ch >= '0' && ch <= '9') return true; } return false; }

function evidenceDetailBonus(txt: string){
  const t = lc(txt);
  let b = 0;
  if(t.includes('qty') || t.includes('quantity') || t.includes('moq') || hasDigit(t)) b += 6; // quantities
  if((t.includes('spec') || t.includes('dimension') || t.includes('mm') || t.includes('inch')) && hasDigit(t)) b += 4; // specs
  if(t.includes('deadline') || t.includes('due ')) b += 3; // dates
  if(t.includes('contact') || t.includes('email') || t.includes('phone') || t.includes(' dm')) b += 2; // contact intent
  return Math.min(12, b);
}

function computeScore(row: { platform: string; region: string; intent_type: string|null; posted_at: number|null; evidence_snippet?: string|null; }){
  const intent = lc(row.intent_type || 'OK').toUpperCase();
  const intentScore = INTENT_WEIGHT[intent] ?? INTENT_WEIGHT.OK;
  const rec = recencyBoost(row.posted_at || 0);
  const src = sourceBoost(row.platform || '');
  const reg = REGION_WEIGHT[row.region as keyof typeof REGION_WEIGHT] ?? 0;
  const ev = String(row.evidence_snippet || '');
  const detail = evidenceDetailBonus(ev);
  const vaguePenalty = (lc(ev).includes('hiring') || lc(ev).includes('job post') || lc(ev).includes('case study') || lc(ev).includes('whitepaper') || lc(ev).includes('infographic')) ? -8 : 0;
  const raw = intentScore + rec + src + reg + detail + vaguePenalty;
  return Math.max(0, Math.min(99, Math.round(raw)));
}

export function scoreRecent(hours = 72){
  ensureSchema();
  const since = Date.now() - hours*3600*1000;
  const rows = db.prepare(
    'SELECT id, platform, region, intent_type, posted_at, evidence_snippet FROM lead_pool WHERE generated_at > ?'
  ).all(since) as Array<any>;

  const upd = db.prepare('UPDATE lead_pool SET lead_score=? WHERE id=?');
  let n = 0;
  for(const r of rows){ const sc = computeScore(r); upd.run(sc, r.id); n++; }
  return { ok: true, scored: n };
}

export function scoreLast7Days(){ return scoreRecent(24*7); }
