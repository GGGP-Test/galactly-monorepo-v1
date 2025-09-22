// src/routes/metrics.ts
import { Router } from 'express';
import {
  buckets,
  getByHost,
  saveByHost,
  ensureLeadForHost,
  findByHost,
} from '../shared/memStore';

const router = Router();

/**
 * GET /api/v1/metrics/watchers?host=example.com
 * Very light heartbeat endpoint the panel polls.
 */
router.get('/watchers', (req, res) => {
  const host = String(req.query.host || '');
  const data = host ? getByHost(host) : null;
  res.json({ ok: true, host, data });
});

/**
 * POST /api/v1/metrics/claim  (panel “Lock & keep”)
 * Body (or query): { host: string }
 * Marks the host as claimed and moves it to HOT if it was in WARM.
 */
router.post('/claim', (req, res) => {
  const host = String((req.body && req.body.host) || req.query.host || '');
  if (!host) return res.status(400).json({ ok: false, error: 'host required' });

  // record a tiny claim stamp for the host
  const claimedAt = new Date().toISOString();
  saveByHost(host, { claimedAt, claimedBy: 'panel' });

  // If there’s a warm lead with this host, promote it to hot.
  const where = findByHost(host);
  if (where?.bucket === 'warm') {
    const lead = buckets.warm.splice(where.index, 1)[0];
    lead.temperature = 'hot';
    buckets.hot.unshift(lead);
  } else if (!where) {
    // If nothing existed yet, at least ensure a lead row exists (warm).
    ensureLeadForHost(host, { temperature: 'hot' });
    const where2 = findByHost(host);
    if (where2?.bucket === 'warm') {
      const lead = buckets.warm.splice(where2.index, 1)[0];
      lead.temperature = 'hot';
      buckets.hot.unshift(lead);
    }
  }

  return res.json({ ok: true, host, promotedTo: 'hot', claimedAt });
});

/**
 * GET /api/v1/metrics/deepen?host=example.com  (panel “Deepen results”)
 * Stub that returns 200 so the UI doesn’t 404. You can plug real logic later.
 */
router.get('/deepen', (req, res) => {
  const host = String(req.query.host || '');
  if (!host) return res.status(400).json({ ok: false, error: 'host required' });

  // No extra signals for now; just acknowledge.
  return res.json({
    ok: true,
    host,
    added: 0,
    message: 'Nothing more to add right now.',
  });
});

export const metricsRouter = router;
export default router;