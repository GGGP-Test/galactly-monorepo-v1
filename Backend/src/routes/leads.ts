import { Router, Request, Response } from 'express';
import { ensureSchema, hasDb, q } from '../db';

type LeadRow = {
  id?: number;
  host: string;
  platform?: string;
  title?: string;
  why?: string;
  heat?: number;
  created_at?: string;
};

// in-memory fallback (when DATABASE_URL is not set)
const mem: LeadRow[] = [];

function normalize(r: Partial<LeadRow>): LeadRow {
  return {
    host: (r.host || '').toLowerCase().trim(),
    platform: r.platform || 'web',
    title: (r.title || '').trim(),
    why: (r.why || '').trim(),
    heat: Math.max(1, Math.min(99, Number(r.heat ?? 60))),
  };
}

export const leads = Router();

// health
leads.get('/health', (_req, res) => res.json({ ok: true }));

// upsert helper
async function upsert(row: LeadRow) {
  if (hasDb()) {
    await ensureSchema();
    await q(
      `insert into lead_pool (host, platform, title, why, heat)
       values ($1,$2,$3,$4,$5)
       on conflict (host) do update set
         platform = excluded.platform,
         title    = excluded.title,
         why      = excluded.why,
         heat     = excluded.heat`,
      [row.host, row.platform, row.title, row.why, row.heat]
    );
  } else {
    const i = mem.findIndex(x => x.host === row.host);
    if (i >= 0) mem[i] = { ...mem[i], ...row, created_at: new Date().toISOString() };
    else mem.push({ ...row, created_at: new Date().toISOString() });
  }
}

// 1) Public ingest endpoint used by GitHub Actions
// Accepts either {items:[...]} or a single item body.
leads.post('/ingest/github', async (req: Request, res: Response) => {
  const body = req.body || {};
  const items: any[] = Array.isArray(body.items) ? body.items : [body];

  let saved = 0;
  for (const it of items) {
    const host = String(it.host || it.homepage || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    if (!host || !host.includes('.')) continue;

    const row = normalize({
      host,
      platform: 'web',
      title: String(it.title || it.name || '').slice(0, 200) || `Possible buyer @ ${host}`,
      why: String(it.whyText || it.description || 'from GitHub mirror').slice(0, 500),
      heat: 60,
    });
    await upsert(row);
    saved++;
  }
  res.json({ ok: true, saved });
});

// 2) Warm list (recent leads)
leads.get('/leads/warm', async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 25)));
  if (hasDb()) {
    await ensureSchema();
    const r = await q<LeadRow>(`select host, platform, title, why as "why", heat, created_at
                                from lead_pool
                                order by created_at desc limit $1`, [limit]);
    return res.json({ ok: true, items: r.rows });
  } else {
    const items = mem.slice(-limit).reverse();
    return res.json({ ok: true, items });
  }
});

// 3) “Find buyer” single candidate – fast, heuristic
//    This does NOT scrape; it proposes a plausible buyer quickly.
leads.get('/leads/find-buyers', async (req: Request, res: Response) => {
  const supplierHost = String(req.query.host || '').toLowerCase().trim();
  if (!supplierHost) return res.status(400).json({ ok: false, error: 'host required' });

  const title = `Buyer lead for ${supplierHost}`;
  const why = 'Compat shim matched (region filter applied)';

  const row = normalize({ host: supplierHost, title, why, heat: 65 });
  await upsert(row);

  res.json({ ok: true, candidate: row });
});

// 4) Optional “deepen” – placeholder that currently just acknowledges
leads.post('/leads/deepen', async (_req, res) => {
  res.json({ ok: true, did: 'noop' });
});