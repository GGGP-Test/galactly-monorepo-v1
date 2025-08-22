// Backend/src/connectors/socialFirehose.ts
// @ts-nocheck
import axios from 'axios';
import { readFileSync } from 'node:fs';

const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 12000);
const HTTP_MAX_BYTES  = Number(process.env.HTTP_MAX_BYTES  || 1_500_000);
const INGEST_CONCURRENCY = Math.max(1, Number(process.env.INGEST_CONCURRENCY || 3));
const FEED_ITEMS_PER_FEED = Math.max(1, Number(process.env.FEED_ITEMS_PER_FEED || 30));
const INGEST_MAX_URLS = Number(process.env.INGEST_MAX_URLS || 400);

function readList(env: string, pathEnv: string): string[] {
  const inline = (process.env[env] || '').split(/[,\r\n]+/).map(s => s.trim()).filter(Boolean);
  const file = process.env[pathEnv] ? (readFileSync(process.env[pathEnv]!, 'utf8') || '') : '';
  const fromFile = file.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const all = Array.from(new Set([...inline, ...fromFile]));
  return INGEST_MAX_URLS > 0 ? all.slice(0, INGEST_MAX_URLS) : all;
}

async function fetchOne(u: string): Promise<number> {
  try {
    const r = await axios.get(u, {
      timeout: HTTP_TIMEOUT_MS,
      maxContentLength: HTTP_MAX_BYTES,
      maxBodyLength: HTTP_MAX_BYTES,
      validateStatus: s => s >= 200 && s < 400,
    });

    const raw = r.data;
    let items: any[] = [];

    if (Array.isArray(raw)) items = raw;
    else if (raw?.items) items = raw.items;
    else if (raw?.data) items = raw.data;

    if (!Array.isArray(items)) return 0;

    // We only return a count to avoid holding big arrays in memory.
    return Math.min(items.length, FEED_ITEMS_PER_FEED);
  } catch {
    return 0;
  }
}

export async function pollSocialFeeds(): Promise<number> {
  const urls = [
    ...readList('FEEDS_NATIVE', 'FEEDS_NATIVE_FILE'),
    ...readList('RSSHUB_FEEDS', 'RSSHUB_FEEDS_FILE'),
  ];
  let total = 0;
  for (let i = 0; i < urls.length; i += INGEST_CONCURRENCY) {
    const slice = urls.slice(i, i + INGEST_CONCURRENCY);
    const counts = await Promise.all(slice.map(fetchOne));
    total += counts.reduce((a, b) => a + b, 0);
  }
  return total;
}
