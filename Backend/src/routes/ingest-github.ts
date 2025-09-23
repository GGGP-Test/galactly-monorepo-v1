// src/routes/ingest-github.ts
import { Router, Request, Response } from 'express';
import { saveByHost, replaceHotWarm, Temp } from '../shared/memStore';

const router = Router();

// quick helpers
function toHost(urlLike: string | undefined): string | undefined {
  if (!urlLike) return undefined;
  try {
    const u = urlLike.includes('://') ? new URL(urlLike) : new URL('https://' + urlLike);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    // fallback: try to spot a domain inside free text
    const m = urlLike.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
    return m ? m[1].toLowerCase() : undefined;
  }
}

type IngestBody = {
  homepage?: string;
  owner?: string;
  name?: string;
  description?: string;
  topics?: string[] | string;
  temp?: Temp | string;
};

// POST /api/ingest/github
router.post('/ingest/github', (req: Request, res: Response) => {
  const b: IngestBody = req.body || {};
  const host =
    toHost(b.homepage) ||
    (b.owner ? `${String(b.owner).toLowerCase()}.github.io` : undefined);

  if (!host) {
    return res.status(400).json({ ok: false, error: 'homepage (or owner) required' });
  }

  const title = b.name ? `Buyer lead for ${b.name}` : `Buyer lead for ${host}`;
  const topics =
    Array.isArray(b.topics) ? b.topics :
    typeof b.topics === 'string' ? b.topics.split(',').map(s => s.trim()).filter(Boolean) : [];

  // persist to our in-memory store (compatible with the panel)
  const whyBits = [];
  if (b.description) whyBits.push(b.description);
  if (topics.length)  whyBits.push(`topics: ${topics.slice(0, 6).join(', ')}`);

  const saved = saveByHost(host, {
    host,
    platform: 'web',
    title,
    created: new Date().toISOString(),
    temperature: 'warm',
    why: whyBits.join(' • ').slice(0, 200),
    saved: true,
  });

  // honor requested temp if present
  const t = String(b.temp || '').toLowerCase();
  if (t === 'hot' || t === 'warm' || t === 'cold') replaceHotWarm(host, t as Temp);

  return res.json({
    ok: true,
    item: {
      host: saved.host,
      platform: saved.platform,
      title: saved.title,
      created: saved.created,
      temp: saved.temperature,
      whyText: saved.why,
    },
  });
});

// tiny health endpoint for pings/debug
router.get('/ingest/github/health', (_req, res) => res.json({ ok: true }));

export default router;