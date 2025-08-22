// Backend/connectors/rss.ts
import Parser from 'rss-parser';
import fs from 'fs';
import { classify, heatFromSource, fitScore } from '../util.js';
import { db, insertLead } from '../db.js';

const parser = new Parser();

function readFileIfSet(envName: string): string {
  const p = process.env[envName];
  if (!p) return '';
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function getAllFeeds(): string[] {
  const joined = [
    process.env.RSS_FEEDS || '',          // legacy (keep tiny if used)
    process.env.RSSHUB_FEEDS || '',
    process.env.FEEDS_NATIVE || '',
    readFileIfSet('RSS_FEEDS_FILE'),
    readFileIfSet('RSSHUB_FEEDS_FILE'),
    readFileIfSet('FEEDS_NATIVE_FILE'),
  ].filter(Boolean).join(',');

  const uniq = new Set(
    joined.split(/[,\r\n]+/).map(s => s.trim()).filter(Boolean)
  );
  return Array.from(uniq);
}

export async function pollRss(){
  const feeds = getAllFeeds();
  if (!feeds.length) return;

  for (const f of feeds) {
    try{
      const feed = await parser.parseURL(f);
      for (const item of (feed.items || [])) {
        const text = `${item.title||''} ${item.contentSnippet||''}`;
        const { cat, kw } = classify(text);
        const lead = {
          cat, kw,
          platform: 'RSS',
          region: 'US' as const,
          fit_user: fitScore(74),
          fit_competition: fitScore(80),
          heat: heatFromSource(f),
          source_url: item.link || '',
          evidence_snippet: (item.contentSnippet||'').slice(0,180),
          generated_at: Date.now(),
          expires_at: Date.now() + 72*3600*1000,
          state: 'available' as const,
          reserved_by: null,
          reserved_until: null,
          company: null,
          person_handle: null,
          contact_email: null
        };
        if (!lead.source_url) continue;
        const exists = await db.prepare(
  `SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?`
).get(lead.source_url, Date.now() - 3*24*3600*1000);
if (!exists) await insertLead(lead as any);
      }
    }catch { /* ignore bad feeds */ }
  }
}
