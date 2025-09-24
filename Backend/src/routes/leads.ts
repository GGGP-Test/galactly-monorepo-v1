// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import {
  buckets,
  ensureLeadForHost,
  replaceHotWarm,
  saveByHost,
} from '../shared/memStore';

const r = Router();

// Small helper to unify payload
function mapLead(l: ReturnType<typeof ensureLeadForHost>) {
  return {
    host: l.host,
    platform: l.platform || 'web',
    title: l.title || 'Buyer lead',
    created: l.created,
    temp: l.temperature,
    whyText: l.why || '',
  };
}

// GET /api/leads/warm
r.get(['/leads/warm', '/warm'], (_req: Request, res: Response) => {
  const { warm } = buckets();
  return res.json({ ok: true, items: warm.map(mapLead) });
});

// GET /api/leads/hot
r.get(['/leads/hot', '/hot'], (_req: Request, res: Response) => {
  const { hot } = buckets();
  return res.json({ ok: true, items: hot.map(mapLead) });
});

// Simple “find one” used by the panel’s big blue button
r.get(['/leads/find', '/leads/find-buyers', '/find', '/find-buyers'], async (req, res) => {
  const host = String(req.query.host || '').trim().toLowerCase();
  if (!host) return res.status(400).json({ ok: false, error: 'host is required' });

  // lightweight “compat shim” until we wire richer discovery
  const lead = saveByHost(host, {
    title: `Buyer lead for ${host}`,
    platform: 'web',
    why: `Compat shim matched (US/CA, 50 mi)`,
    temperature: 'warm',
    saved: true,
  });

  replaceHotWarm(host, 'warm');
  return res.json({ ok: true, items: [mapLead(lead)] });
});

export default r;