// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  buckets,
  StoredLead,
  Temp,
} from '../shared/memStore';

const r = Router();

function nowISO() {
  return new Date().toISOString();
}

function toHost(s: string | undefined): string | undefined {
  if (!s) return undefined;
  try {
    const u = s.includes('://') ? new URL(s) : new URL('https://' + s);
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return h.includes('.') ? h : undefined;
  } catch {
    return undefined;
  }
}

function toItem(lead: StoredLead) {
  return {
    host: lead.host,
    platform: lead.platform ?? 'web',
    title: lead.title ?? `Buyer lead for ${lead.host}`,
    created: lead.created,
    temp: lead.temperature === 'hot' ? 'hot' : lead.temperature === 'warm' ? 'warm' : 'cold',
    whyText: lead.why ?? '',
  };
}

// ---------- GET /leads/warm ----------
r.get('/leads/warm', (_req: Request, res: Response) => {
  const b = buckets();
  const items = b.warm.map(toItem);
  res.json({ ok: true, items });
});

// ---------- GET /leads/hot ----------
r.get('/leads/hot', (_req: Request, res: Response) => {
  const b = buckets();
  const items = b.hot.map(toItem);
  res.json({ ok: true, items });
});

// ---------- POST /leads/lock ----------
/*
  Body examples:
  { "host": "acme.com", "temp": "warm" }
  { "host": "acme.com", "temp": "hot" }
*/
r.post('/leads/lock', (req: Request, res: Response) => {
  const host = String(req.body?.host ?? '').trim().toLowerCase();
  const t = String(req.body?.temp ?? 'warm').toLowerCase() as Temp;
  if (!host) return res.status(400).json({ ok: false, error: 'host required' });
  const updated = replaceHotWarm(host, t);
  res.json({ ok: true, item: toItem(updated) });
});

// ---------- POST /ingest/github ----------
/*
  Accepts either:
    - { items: [{ homepage, owner, name, description, topics, temp? }, ...] }
    - or an array of those objects directly
*/
r.post('/ingest/github', (req: Request, res: Response) => {
  const raw = Array.isArray(req.body) ? req.body : (req.body?.items ?? []);
  if (!Array.isArray(raw)) {
    return res.status(400).json({ ok: false, error: 'items[] required' });
  }

  let saved = 0;
  const out: StoredLead[] = [];

  for (const it of raw) {
    const homepage: string | undefined = it?.homepage ?? '';
    const host = toHost(homepage);
    if (!host) continue;

    const temp: Temp = (String(it?.temp ?? 'warm').toLowerCase() as Temp) || 'warm';

    // seed or update the lead
    const title =
      (it?.name ? `Repo ${it.name} — possible buyer @ ${host}` : undefined) ??
      `Buyer lead for ${host}`;

    const why =
      (it?.description ? String(it.description) + ' ' : '') +
      '(from GitHub mirror)';

    const lead = saveByHost(host, {
      title,
      platform: 'web',
      created: nowISO(),
      temperature: temp,
      why,
      saved: true,
    });

    out.push(lead);
    saved++;
  }

  res.json({ ok: true, saved, items: out.map(toItem) });
});

// Optional stub so the panel’s “Deeper results” doesn’t explode if it calls it
r.post('/leads/deepen', (req: Request, res: Response) => {
  const host = String(req.body?.host ?? '').trim().toLowerCase();
  if (!host) return res.status(400).json({ ok: false, error: 'host required' });
  // You can enrich here later; for now return dummy watchers/competitors.
  res.json({ ok: true, host, watchers: [], competitors: [] });
});

export default r;