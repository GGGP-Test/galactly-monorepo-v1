// src/routes/metrics.ts
import { Router } from 'express';
import {
  buckets,
  getByHost,
  ensureLeadForHost,
  replaceHotWarm,
  type Temp,
  type StoredLead,
} from '../shared/memStore';

export const metricsRouter = Router();

/**
 * GET /api/v1/metrics/watchers?host=...
 * The panel polls this. We return sizes and arrays.
 */
metricsRouter.get('/watchers', (req, res) => {
  const host = String(req.query.host ?? '');
  const { watchers, competitors } = buckets(host);
  res.json({
    ok: true,
    counts: { watchers: watchers.size, competitors: competitors.size },
    watchers: Array.from(watchers),
    competitors: Array.from(competitors),
  });
});

/**
 * GET /api/v1/metrics/deepen?host=...
 * The panel calls this when you click “Deepen results”.
 * For now we just echo whatever we have stored for that host.
 */
metricsRouter.get('/deepen', (req, res) => {
  const host = String(req.query.host ?? '');
  if (!host) return res.status(400).json({ ok: false, error: 'missing host' });
  const leads = getByHost(host);
  res.json({ ok: true, leads });
});

/**
 * POST /api/v1/metrics/claim
 * Body: { host, id, actor }
 * The panel calls this when you “Lock & keep”.
 * We’ll just mark the lead as "hot".
 */
metricsRouter.post('/claim', (req, res) => {
  const { host, id } = req.body ?? {};
  if (!host || !id) return res.status(400).json({ ok: false, error: 'missing host or id' });
  replaceHotWarm(String(host), String(id), 'hot');
  res.json({ ok: true, claimed: { host, id } });
});

/**
 * Optional: a tiny health probe for the container’s HEALTHCHECK
 */
metricsRouter.get('/healthz', (_req, res) => res.json({ ok: true }));