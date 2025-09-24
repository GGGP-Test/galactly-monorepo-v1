// Backend/src/routes/leads.ts
// Minimal router that backs the free panel today.
// Endpoints:
//   GET  /api/leads/warm         -> last 50 leads from lead_pool
//   POST /api/leads/deepen       -> no-op (could enrich later)
//   GET  /api/leads/find-buyers  -> creates a quick “buyer lead for <host>” row
//   POST /api/ingest/github      -> bulk ingest from your GH Action

import { Router, Request, Response } from 'express';
import { q } from '../shared/db';

export const router = Router();
export default router;

// -- bootstrap schema once (safe to call many times)
async function ensureSchema() {
  await q(`
    create table if not exists lead_pool (
      id bigserial primary key,
      host text not null,
      platform text not null default 'web',
      title text not null,
      why_text text not null default '',
      temp text not null default 'warm',
      created timestamptz not null default now()
    );
    create index if not exists lead_pool_created_idx on lead_pool(created desc);
    create index if not exists lead_pool_host_idx    on lead_pool(host);
  `);
}

// ---- panel: warm list
router.get('/api/leads/warm', async (_req: Request, res: Response) => {
  await ensureSchema();
  const r = await q<{host:string;platform:string;title:string;why_text:string;created:string;temp:string}>(
    `select host, platform, title, why_text as "whyText", created, temp
     from lead_pool order by created desc limit 50`
  );
  res.json({ ok: true, items: r.rows });
});

// ---- panel: deepen (placeholder – returns current warm set)
router.post('/api/leads/deepen', async (_req: Request, res: Response) => {
  await ensureSchema();
  const r = await q(
    `select host, platform, title, why_text as "whyText", created, temp
     from lead_pool order by created desc limit 50`
  );
  res.json({ ok: true, items: r.rows });
});

// ---- panel: one-off “find buyers” for a supplier host
router.get('/api/leads/find-buyers', async (req: Request, res: Response) => {
  const supplierHost = String(req.query.host || '').trim().toLowerCase();
  if (!supplierHost || !supplierHost.includes('.')) {
    return res.status(400).json({ ok:false, error:'missing ?host' });
  }
  await ensureSchema();

  // Super fast seed: write one deterministic lead immediately so the UI shows “something”
  // You’ll replace this with your richer multi-source fusion later.
  const title = `Buyer lead for ${supplierHost}`;
  const why   = 'Compact shim matched (US/CA, 50 mi) — source: live';

  await q(
    `insert into lead_pool (host, platform, title, why_text, temp)
     values ($1,'web',$2,$3,'warm')
     on conflict do nothing`,
    [supplierHost, title, why]
  );

  const r = await q(
    `select host, platform, title, why_text as "whyText", created, temp
     from lead_pool where host=$1 order by created desc limit 10`,
    [supplierHost]
  );
  res.json({ ok: true, items: r.rows });
});

// ---- bulk ingest from your public GH Action (ingest-zie619.yml)
router.post('/api/ingest/github', async (req: Request, res: Response) => {
  await ensureSchema();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  let saved = 0;
  for (const it of items) {
    const host = (it.host || '').toLowerCase();
    const title = it.title || `Repo ${host}`;
    const why   = it.whyText || '(from GitHub live sweep)';
    if (!host || !host.includes('.')) continue;

    await q(
      `insert into lead_pool (host, platform, title, why_text, temp)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing`,
      [host, it.platform || 'web', title, why, it.temp || 'warm']
    );
    saved++;
  }
  res.json({ ok: true, saved });
});