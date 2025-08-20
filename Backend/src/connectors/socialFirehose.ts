// @ts-nocheck
import axios from 'axios';
import { readFileSync } from 'node:fs';

function readList(env: string, pathEnv: string): string[] {
  const inline = (process.env[env] || '').split(/[,\r\n]+/).map(s => s.trim()).filter(Boolean);
  const file = process.env[pathEnv] ? (readFileSync(process.env[pathEnv]!, 'utf8') || '') : '';
  const fromFile = file.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return Array.from(new Set([...inline, ...fromFile]));
}

export async function pollSocialFeeds(): Promise<any[]> {
  const urls = [
    ...readList('FEEDS_NATIVE', 'FEEDS_NATIVE_FILE'),
    ...readList('RSSHUB_FEEDS', 'RSSHUB_FEEDS_FILE')
  ];
  const out: any[] = [];
  for (const u of urls) {
    try {
      const r = await axios.get(u, { timeout: 10000 });
      const items = (r.data?.items || r.data?.data || r.data || []) as any[];
      if (Array.isArray(items)) out.push(...items);
    } catch (_e: any) {}
  }
  return out;
}
export { pollSocialFeeds as pollSocialFirehose };
