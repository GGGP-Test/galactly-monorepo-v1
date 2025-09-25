import { Router, Request, Response } from 'express';
import { findTierCCandidates, loadCatalogFromEnv, Candidate } from '../lib/tierc';

const router = Router();

/* ------------------------------------------------------------------ */
/* Health                                                             */
/* ------------------------------------------------------------------ */

router.get('/healthz', (_req, res) => {
  try {
    const bundle = loadCatalogFromEnv();
    const abCount = bundle.ab.buyers?.length || 0;
    const cCount = bundle.c.buyers?.length || 0;
    res.json({
      ok: true,
      service: 'buyers-api',
      catalogs: { tierAB: abCount, tierC: cCount },
      now: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get('/api/healthz', (_req, res) => res.redirect(307, '/healthz'));

/* ------------------------------------------------------------------ */
/* Leads: find buyers (Tier-C first, with city/segment boosts)        */
/* ------------------------------------------------------------------ */

router.get('/api/leads/find-buyers', (req: Request, res: Response) => {
  try {
    const city = (req.query.city as string | undefined)?.trim() || undefined;

    const segRaw = (req.query.segments as string | undefined) || '';
    const segmentHints =
      segRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean) || undefined;

    const items: Candidate[] = findTierCCandidates({
      city,
      segmentHints,
      preferTierC: true,
      limit: 20,
    });

    if (items.length === 0) {
      return res.status(200).json({ items: [], error: 'no match' });
    }

    return res.json({ items });
  } catch (err: any) {
    return res.status(500).json({ items: [], error: String(err?.message || err) });
  }
});

/* ------------------------------------------------------------------ */
/* Leads: lock (echo back for client-side session saving)             */
/* ------------------------------------------------------------------ */

router.post('/api/leads/lock', (req: Request, res: Response) => {
  try {
    const { host, title, temp, why } = req.body || {};
    if (!host || !title) {
      return res.status(400).json({ ok: false, error: 'candidate with host and title required' });
    }

    const item: Candidate = {
      host: String(host),
      platform: 'web',
      title: String(title),
      created: new Date().toISOString(),
      temp: temp === 'hot' ? 'hot' : 'warm',
      why: why ? String(why) : 'locked by user',
      score: 100,
    };

    return res.json({ ok: true, item });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;