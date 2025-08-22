// Backend/src/connectors/rss.ts
import Parser from 'rss-parser';
import { readFileSync } from 'node:fs';
import { classify, heatFromSource, fitScore } from '../util.js';
import { db, insertLead } from '../db.js';

const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 12000);
const HTTP_MAX_BYTES  = Number(process.env.HTTP_MAX_BYTES  || 1_500_000); // ~1.5MB per feed
const INGEST_CONCURRENCY = Math.max(1, Number(process.env.INGEST_CONCURRENCY || 3));
const FEED_ITEMS_PER_FEED = Math.max(1, Number(process.env.FEED_ITEMS_PER_FEED || 30));
const INGEST_MAX_URLS = Number(process.env.INGEST_MAX_URLS || 400); // hard cap

const parser = new Parser<any, any>({
  requestOptions: {
    headers: { 'user-agent': 'GalactlyBot/1.0 (+https://galactly.com)' },
    timeout: HTTP_TIMEOUT_MS,
    // rss-parser forwards "size" to node-fetch to cap response bytes:
    // https://www.npmjs.com/package/node-fetch#options
    size: HTTP_MAX_BYTES,
  },
});

function readFileIfSet(envName: string): string {
  const p = process.env[envName];
  if (!p) return '';
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

function getAllFeeds(): string[] {
  const joined = [
    process.env.RSS_FEEDS || '',
    process.env.RSSHUB_FEEDS || '',
    process.env.FEEDS_NATIVE || '',
    readFileIfSet('RSS_FEEDS_FILE'),
    readFileIfSet('RSSHUB_FEEDS_FILE'),
    readFileIfSet('FEEDS_NATIVE_FILE'),
  ].filter(Boolean).join(',');

  const uniq = new Set(
    joined.split(/[,\r\n]+/).map(s => s.trim()).filter(Boolean)
  );
  const all = Array.from(uniq);
  return INGEST_MAX_URLS > 0 ? all.slice(0, INGEST_MAX_URLS) : all;
}

async function handleFeed(url: string) {
  try {
    const feed = await parser.parseURL(url);
    const items = Array.isArray(feed.items) ? feed.items.slice(0, FEED_ITEMS_PER_FEED) : [];

    for (const item of items) {
      const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`;
      const { cat, kw } = classify(text);

      const lead = {
        cat, kw,
        platform: 'RSS',
        region: 'US' as const,
        fit_user: fitScore(74),
        fit_competition: fitScore(80),
        heat: heatFromSource(url),
        source_url: item.link || '',
        evidence_snippet: String(item.contentSnippet ?? '').slice(0, 180),
        generated_at: Date.now(),
        expires_at: Date.now() + 72 * 3600 * 1000,
        state: 'available' as const,
        reserved_by: null,
        reserved_until: null,
        company: null,
        person_handle: null,
        contact_email: null,
      };

      if (!lead.source_url) continue;

      const exists = await db
        .prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?`)
        .get(lead.source_url, Date.now() - 3 * 24 * 3600 * 1000);

      if (!exists) await insertLead(lead as any);
    }
  } catch {
    // ignore bad/missing feeds
  }
}

export async function pollRss(): Promise<void> {
  const feeds = getAllFeeds();
  if (!feeds.length) return;

  // process in small concurrent batches to keep memory low
  for (let i = 0; i < feeds.length; i += INGEST_CONCURRENCY) {
    const slice = feeds.slice(i, i + INGEST_CONCURRENCY);
    await Promise.all(slice.map(handleFeed));
  }
}
