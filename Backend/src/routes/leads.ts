import express, { Request, Response } from 'express';
import { q } from '../db';

type LeadRow = {
  id: number;
  cat: string;
  kw: string[] | null;
  platform: string | null;
  source_url: string | null;
  title: string | null;
  created_at: string;
};

type Why = { label: string; kind: 'meta' | 'platform' | 'signal'; score: number; detail: string };

function safeHost(u?: string | null) {
  try {
    return u ? new URL(u).host : null;
  } catch {
    return null;
  }
}

function scoreLead(row: LeadRow) {
  const host = safeHost(row.source_url);
  const why: Why[] = [];

  if (host) {
    const tld = host.split('.').pop()?.toLowerCase() || '';
    const dq = ['com', 'ca', 'co', 'io', 'ai'].includes(tld) ? 0.65 : 0.3;
    why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host} (.${tld})` });
  }

  if (row.platform) {
    const pf = row.platform === 'shopify' ? 0.75 : row.platform === 'woocommerce' ? 0.6 : 0.5;
    why.push({ label: 'Platform fit', kind: 'platform', score: pf, detail: row.platform });
  }

  const kws = (row.kw || []).map(k => (k || '').toLowerCase());
  const intent = ['packaging', 'carton', 'labels', 'rfq', 'rfp', 'mailers'];
  if (kws.length > 0) {
    const hasIntent = intent.some(k => kws.includes(k));
    why.push({
      label: 'Intent keywords',
      kind: 'signal',
      score: hasIntent ? 0.9 : 0.6,
      detail: kws.join(', ')
    });
  }

  const avg = why.reduce((a, w) => a + w.score, 0) / Math.max(1, why.length);
  const temperature: 'hot' | 'warm' = avg >= 0.7 ? 'hot' : 'warm';

  return { host, why, temperature, confidence: avg };
}

function requireApiKey(req: Request, res: Response) {
  const key = req.header('x-api-key');
  const expected = process.env.ADMIN_TOKEN || process.env.API_KEY;
  if (!key || key !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return null;
  }
  return key;
}

async function ensureAuxTables() {
  await q(
    `CREATE TABLE IF NOT EXISTS lead_meta(
       lead_id bigint PRIMARY KEY,
       stage text,
       updated_at timestamptz DEFAULT now()
     )`
  );
  await q(
    `CREATE TABLE IF NOT EXISTS lead_notes(
       id bigserial PRIMARY KEY,
       lead_id bigint NOT NULL,
       note text NOT NULL,
       created_at timestamptz DEFAULT now()
     )`
  );
}

export function mountLeads(app: express.Express) {
  const r = express.Router();

  // GET /api/v1/leads/:id
  r.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });

    const rs = await q<LeadRow>(
      'SELECT id, cat, kw, platform, source_url, title, created_at FROM lead_pool WHERE id=$1 LIMIT 1',
      [id]
    );
    const row = rs.rows[0];
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

    const s = scoreLead(row);
    res.json({
      ok: true,
      temperature: s.temperature,
      lead: {
        id: String(row.id),
        platform: row.platform,
        cat: row.cat,
        host: s.host,
        title: row.title || s.host,
        created_at: row.created_at
      },
      why: s.why
    });
  });

  async function listByTemp(temp: 'hot' | 'warm', limit: number) {
    const rs = await q<LeadRow>(
      'SELECT id, cat, kw, platform, source_url, title, created_at FROM lead_pool ORDER BY created_at DESC LIMIT $1',
      [Math.min(100, Math.max(1, limit * 3))]
    );
    return rs.rows
      .map(row => ({ row, s: scoreLead(row) }))
      .filter(x => x.s.temperature === temp)
      .slice(0, limit)
      .map(({ row, s }) => ({
        id: String(row.id),
        platform: row.platform,
        cat: row.cat,
        host: s.host,
        title: row.title || s.host,
        created_at: row.created_at,
        temperature: s.temperature,
        why: s.why
      }));
  }

  // GET /api/v1/leads/hot|warm
  r.get('/hot', async (req, res) => {
    const limit = Number(req.query.limit || 10);
    res.json({ ok: true, items: await listByTemp('hot', limit) });
  });
  r.get('/warm', async (req, res) => {
    const limit = Number(req.query.limit || 10);
    res.json({ ok: true, items: await listByTemp('warm', limit) });
  });

  // POST /api/v1/leads/ingest
  r.post('/ingest', async (req, res) => {
    if (!requireApiKey(req, res)) return;
    const b = req.body || {};
    const kw = Array.isArray(b.kw) ? b.kw : [];
    const ins = await q<LeadRow>(
      'INSERT INTO lead_pool(cat, kw, platform, source_url, title) VALUES ($1,$2,$3,$4,$5) RETURNING id, cat, kw, platform, source_url, title, created_at',
      [b.cat || 'product', kw, b.platform || null, b.source_url || null, b.title || null]
    );
    const row = ins.rows[0];
    const s = scoreLead(row);
    res.json({
      ok: true,
      temperature: s.temperature,
      lead: {
        id: String(row.id),
        platform: row.platform,
        cat: row.cat,
        host: s.host,
        title: row.title || s.host,
        created_at: row.created_at
      },
      why: s.why
    });
  });

  // POST /api/v1/leads/ingest/bulk
  r.post('/ingest/bulk', async (req, res) => {
    if (!requireApiKey(req, res)) return;
    const items = Array.isArray(req.body) ? req.body : [];
    const out: any[] = [];
    for (const it of items) {
      const kw = Array.isArray(it.kw) ? it.kw : [];
      const ins = await q<LeadRow>(
        'INSERT INTO lead_pool(cat, kw, platform, source_url, title) VALUES ($1,$2,$3,$4,$5) RETURNING id, cat, kw, platform, source_url, title, created_at',
        [it.cat || 'product', kw, it.platform || null, it.source_url || null, it.title || null]
      );
      const row = ins.rows[0];
      const s = scoreLead(row);
      out.push({
        id: String(row.id),
        platform: row.platform,
        cat: row.cat,
        host: s.host,
        title: row.title || s.host,
        created_at: row.created_at,
        temperature: s.temperature,
        why: s.why
      });
    }
    res.json({ ok: true, inserted: out.length, items: out });
  });

  // PATCH /api/v1/leads/:id/stage
  r.patch('/:id/stage', async (req, res) => {
    if (!requireApiKey(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    const stage = String((req.body?.stage || '').toString());
    if (!stage) return res.status(400).json({ ok: false, error: 'missing stage' });
    await ensureAuxTables();
    await q(
      'INSERT INTO lead_meta(lead_id, stage) VALUES($1,$2) ON CONFLICT (lead_id) DO UPDATE SET stage=EXCLUDED.stage, updated_at=now()',
      [id, stage]
    );
    res.json({ ok: true, leadId: id, stage });
  });

  // POST /api/v1/leads/:id/notes
  r.post('/:id/notes', async (req, res) => {
    if (!requireApiKey(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    const note = String((req.body?.note || '').toString());
    if (!note) return res.status(400).json({ ok: false, error: 'missing note' });
    await ensureAuxTables();
    await q('INSERT INTO lead_notes(lead_id, note) VALUES($1,$2)', [id, note]);
    res.json({ ok: true, leadId: id });
  });

  // GET /api/v1/leads/export.csv
  r.get('/export.csv', async (req, res) => {
    const temp = (String(req.query.temperature || 'hot').toLowerCase() === 'warm') ? 'warm' : 'hot';
    const limit = Number(req.query.limit || 100);
    const items = await listByTemp(temp as 'hot' | 'warm', limit);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${temp}.csv"`);

    const header = 'id,platform,cat,host,title,created_at,temperature\n';
    const rows = items
      .map(it => [
        it.id,
        it.platform || '',
        it.cat || '',
        it.host || '',
        (it.title || '').replace(/"/g, '""'),
        it.created_at,
        it.temperature
      ])
      .map(cols => `${cols[0]},"${cols[1]}","${cols[2]}","${cols[3]}","${cols[4]}","${cols[5]}","${cols[6]}"`)
      .join('\n');

    res.send(header + rows + (rows ? '\n' : ''));
  });

  app.use('/api/v1/leads', r);
}
