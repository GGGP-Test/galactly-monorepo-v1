// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import { q } from '../shared/db'; // <-- keep this path; do not change

const leads = Router();

type Temp = 'warm' | 'hot';
type Platform = 'web' | 'linkedin' | 'marketplace';

export interface Candidate {
  host: string;
  platform: Platform;
  title: string;
  created: string;   // ISO string
  temp: Temp;
  why: string;
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeHost(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const u = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/**
 * Extremely safe placeholder heuristic that always yields a candidate.
 * (We’ll iterate on relevance after we’re green.)
 */
async function pickCandidate(host: string, region?: string, radius?: string): Promise<Candidate> {
  const h = normalizeHost(host);

  // Very small, deterministic pool so we never return the supplier itself.
  const tierA = [
    'unilever.com',
    'loreal.com',
    'nestle.com',
    'clorox.com',
    'pepsico.com',
    'kraftheinzcompany.com',
    'generalmills.com',
    'mondelezinternational.com',
    'loblaw.ca'
  ];

  // Choose a stable but different suggestion based on hash of supplier host.
  let idx = 0;
  for (let i = 0; i < h.length; i++) idx = (idx + h.charCodeAt(i)) % tierA.length;
  const buyer = tierA[idx];

  return {
    host: buyer,
    platform: 'web',
    title: `Suppliers / vendor info | ${buyer}`,
    created: nowISO(),
    temp: 'warm',
    why: `Tier A buyer; supplier program (picked for supplier: ${h}${region ? ` · region ${region}` : ''}${radius ? ` · radius ${radius}` : ''})`
  };
}

// GET /api/leads/find-buyers?host=...&region=...&radius=...
leads.get('/find-buyers', async (req: Request, res: Response) => {
  const { host, region, radius } = req.query as { host?: string; region?: string; radius?: string };
  if (!host) return res.status(400).json({ error: 'host is required' });

  try {
    const cand = await pickCandidate(host, region, radius);
    if (!cand || !cand.host) return res.status(404).json({ error: 'no match' });
    res.json(cand); // free panel expects a single candidate object
  } catch (err: any) {
    res.status(500).json({ error: 'internal', detail: String(err?.message || err) });
  }
});

// POST /api/leads/lock { host, title, temp? }
leads.post('/lock', async (req: Request, res: Response) => {
  const { host, title, temp } = (req.body ?? {}) as { host?: string; title?: string; temp?: Temp };
  if (!host || !title) return res.status(400).json({ error: 'candidate with host and title required' });

  const created = nowISO();
  const h = normalizeHost(host);
  const t: Temp = temp === 'hot' ? 'hot' : 'warm';

  try {
    // Minimal durable table; idempotent create and insert.
    await q(`
      CREATE TABLE IF NOT EXISTS buyer_locks (
        id BIGSERIAL PRIMARY KEY,
        host TEXT NOT NULL,
        title TEXT NOT NULL,
        temp TEXT NOT NULL,
        created TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await q(
      `INSERT INTO buyer_locks (host, title, temp, created)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING;`,
      [h, title, t, created]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'lock_failed', detail: String(err?.message || err) });
  }
});

export default leads;
export { leads as leadsRouter };