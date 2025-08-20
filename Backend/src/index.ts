// @ts-nocheck
import type { Express, Request, Response } from 'express';
import { pollSocialFeeds } from './connectors/socialFirehose.js';
import { pollSamGov } from './connectors/samGov.js';
import { pollReddit } from './connectors/reddit.js';
import { pollRss } from './connectors/rss.js';

// Used by scheduler or one-off warmups
export async function runIngestOnce() {
  const results = await Promise.allSettled([
    pollSamGov(),
    pollReddit(),
    pollRss(),
    (async () => (await pollSocialFeeds()).length)()
  ]);
  return { ok: true, results };
}

// *** This is what index.ts expects ***
export function mountIngest(app: Express) {
  app.get('/api/v1/admin/poll-now', async (req: Request, res: Response) => {
    const src = String(req.query.source || 'all').toLowerCase();
    try {
      if (src === 'sam' || src === 'all') await pollSamGov();
      if (src === 'reddit' || src === 'all') await pollReddit();
      if (src === 'rss' || src === 'all') await pollRss();
      if (src === 'social' || src === 'all') await pollSocialFeeds();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
  });
}

export default {};
