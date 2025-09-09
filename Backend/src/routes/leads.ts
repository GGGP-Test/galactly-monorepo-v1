// Backend/src/routes/leads.ts
// Full file — mounts all /api/v1/leads routes (list, get, ingest, bulk, stage, notes, export.csv)

import express from 'express';
import { q } from '../db';
import { requireApiKey } from '../auth';

// ---------- types ----------
type LeadRow = {
  id: number;
  cat: string | null;
  kw: string[] | null;
  platform: string | null;
  source_url: string | null;
  title: string | null;
  snippet?: string | null;
  created_at: string;
};

type Why = { label: string; kind: 'meta' | 'platform' | 'signal'; score: number; detail?: string };

type Scored = {
  temperature: 'hot' | 'warm';
  why: Why[];
  packagingMath?: {
    spendPerMonth: number | null;
    estOrdersPerMonth: number | null;
    estUnitsPerMonth: number | null;
    packagingTypeHint: string | null;
    confidence: number;
  };
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// ---------- small helpers ----------
function hostFrom(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.host || null;
  } catch {
    return null;
  }
}

function scoreLead(row: LeadRow): Scored {
  const why: Why[] = [];
  const host = hostFrom(row.source_url) || 'example.com';

  // Domain quality (very rough)
  const tld = host.split('.').pop() || '';
  const dq = ['com', 'co', 'io', 'ai', 'ca'].includes(tld.toLowerCase()) ? 0.65 : 0.3;
  why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host} (.${tld})` });

  // Platform fit
  const p = (row.platform || '').toLowerCase();
  const pScore = p === 'shopify' ? 0.75 : p === 'woocommerce' ? 0.6 : p ? 0.5 : 0.4;
  if (p) why.push({ label: 'Platform fit', kind: 'platform', score: pScore, detail: p });

  // Intent keywords
  const kws = (row.kw || []).map(k => k.toLowerCase());
  const hasRfp = kws.some(k => /rfp|rfq/.test(k));
  const hasPkg = kws.some(k => /(packaging|carton|poly|mailers|labels?)/.test(k));
  const kScore = hasRfp && hasPkg ? 0.9 : hasPkg ? 0.8 : hasRfp ? 0.75 : 0.5;
  if (kws.length) {
    why.push({ label: 'Intent keywords', kind: 'signal', score: kScore, detail: kws.join(', ') });
  }

  // Temperature
  const avg = why.reduce((a, b) => a + b.score, 0) / (why.length || 1);
  const temperature: 'hot' | 'warm' = avg >= 0.7 ? 'hot' : 'warm';

  // Packaging math (placeholder estimates but deterministic & non-null for confidence)
  const packagingMath = {
    spendPerMonth: null,
    estOrdersPerMonth: null,
    estUnitsPerMonth: null,
    packagingTypeHint:
      row.cat === 'product'
        ? 'cartons/labels'
        : row.cat === 'procurement'
        ? 'general packaging'
        : null,
    confidence: clamp(avg, 0, 1),
  };

  return { temperature, why, packagingMath };
}

function shape(row: LeadRow) {
  const host = hostFrom(row.source_url) || 'example.com';
  const s = scoreLead(row);
  return {
    temperature: s.temperature,
    why: s.why,
    packagingMath: s.packagingMath,
    lead: {
      id: String(row.id),
      platform: row.platform || null,
      cat: row.cat || null,
      host,
      title: row.title || host,
      created_at: row.created_at,
    },
  };
}

// ---------- schema helpers ----------
async function ensureLeadPool() {
  await q(`
    CREATE TABLE IF NOT EXISTS lead_pool(
      id BIGSERIAL PRIMARY KEY,
      cat TEXT,
      kw TEXT[],
      platform TEXT,
      source_url TEXT,
      title TEXT,
      snippet TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_pool_time ON lead_pool(created_at DESC);
  `);
}

async function ensureAuxTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS lead_meta(
      lead_id BIGINT PRIMARY KEY REFERENCES lead_pool(id) ON DELETE CASCADE,
      stage TEXT NOT NULL DEFAULT 'new',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS lead_notes(
      id BIGSERIAL PRIMARY KEY,
      lead_id BIGINT NOT NULL REFERENCES lead_pool(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id, created_at DESC);
  `);
}

// ---------- core queries ----------
async function fetchLatest(limit: number): Promise<LeadRow[]> {
  await ensureLeadPool();
  const rs = await q<LeadRow>(
    `SELECT id, cat, kw, platform, source_url, title, snippet, created_at
     FROM lead_pool
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rs.rows;
}

async function fetchById(id: number): Promise<LeadRow | null> {
  await ensureLeadPool();
  const rs = await q<LeadRow>(
    `SELECT id, cat, kw, platform, source_url, title, snippet, created_at
     FROM lead_pool WHERE id=$1 LIMIT 1`,
    [id]
  );
  return rs.rows[0] || null;
}

// ---------- mounting ----------
export function mountLeads(app: express.Express) {
  const r = express.Router();

  // GET /api/v1/leads/hot?limit=10
  r.get('/hot', async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
    const rows = await fetchLatest(limit * 4); // overfetch, then filter
    const items = rows
      .map(shape)
      .filter(x => x.temperature === 'hot')
      .slice(0, limit)
      .map(x => ({
        ...x.lead,
        temperature: x.temperature,
        why: x.why,
      }));
    res.json({ ok: true, items });
  });

  // GET /api/v1/leads/warm?limit=10
  r.get('/warm', async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
    const rows = await fetchLatest(limit * 6);
    const items = rows
      .map(shape)
      .filter(x => x.temperature === 'warm')
      .slice(0, limit)
      .map(x => ({
        ...x.lead,
        temperature: x.temperature,
        why: x.why,
      }));
    res.json({ ok: true, items });
  });

  // GET /api/v1/leads/:id
  r.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    const row = await fetchById(id);
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, ...shape(row) });
  });

  // POST /api/v1/leads/ingest  (requires x-api-key)
  r.post('/ingest', requireApiKey, express.json(), async (req, res) => {
    const { cat, kw, platform, source_url, title, snippet } = req.body || {};
    if (!source_url || !title)
      return res.status(400).json({ ok: false, error: 'missing fields: source_url, title' });

    await ensureLeadPool();
    const rs = await q<{ id: number }>(
      `INSERT INTO lead_pool(cat, kw, platform, source_url, title, snippet)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [cat || null, Array.isArray(kw) ? kw : null, platform || null, source_url, title, snippet || null]
    );
    const id = rs.rows[0].id;
    const row = await fetchById(id);
    res.json({ ok: true, ...(row ? shape(row) : { id: String(id) }) });
  });

  // POST /api/v1/leads/ingest/bulk  (requires x-api-key)
  r.post('/ingest/bulk', requireApiKey, express.json(), async (req, res) => {
    const items = Array.isArray(req.body) ? req.body : [];
    await ensureLeadPool();
    let inserted = 0;
    const out: any[] = [];
    for (const it of items) {
      if (!it?.source_url || !it?.title) continue;
      const rs = await q<{ id: number }>(
        `INSERT INTO lead_pool(cat, kw, platform, source_url, title, snippet)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [it.cat || null, Array.isArray(it.kw) ? it.kw : null, it.platform || null, it.source_url, it.title, it.snippet || null]
      );
      const id = rs.rows[0].id;
      const row = await fetchById(id);
      if (row) {
        const shaped = shape(row);
        out.push({
          id: shaped.lead.id,
          platform: shaped.lead.platform,
          cat: shaped.lead.cat,
          host: shaped.lead.host,
          title: shaped.lead.title,
          created_at: shaped.lead.created_at,
          temperature: shaped.temperature,
          why: shaped.why,
        });
      }
      inserted++;
    }
    res.json({ ok: true, inserted, items: out });
  });

  // PATCH /api/v1/leads/:id/stage   (requires x-api-key)
  r.patch('/:id/stage', requireApiKey, express.json(), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    const { stage } = req.body || {};
    if (!stage || typeof stage !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing stage' });
    }
    await ensureAuxTables();
    await q(
      `INSERT INTO lead_meta(lead_id, stage, updated_at)
       VALUES ($1,$2,now())
       ON CONFLICT (lead_id) DO UPDATE SET stage=EXCLUDED.stage, updated_at=now()`,
      [id, stage]
    );
    res.json({ ok: true, leadId: id, stage });
  });

  // POST /api/v1/leads/:id/notes   (requires x-api-key)
  r.post('/:id/notes', requireApiKey, express.json(), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    const { note } = req.body || {};
    if (!note || typeof note !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing note' });
    }
    await ensureAuxTables();
    await q(`INSERT INTO lead_notes(lead_id, note) VALUES ($1,$2)`, [id, note]);
    res.json({ ok: true, leadId: id });
  });

  // GET /api/v1/leads/:id/notes
  r.get('/:id/notes', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
    await ensureAuxTables();
    const rs = await q<{ id: number; note: string; created_at: string }>(
      `SELECT id, note, created_at
       FROM lead_notes
       WHERE lead_id=$1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id]
    );
    res.json({ ok: true, items: rs.rows });
  });

  // GET /api/v1/leads/export.csv?temperature=hot|warm|all&limit=50
  r.get('/export.csv', async (req, res) => {
    const temp = String(req.query.temperature || 'hot').toLowerCase();
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
    const rows = await fetchLatest(limit * 10).then(rs => rs.map(shape));

    const filtered =
      temp === 'all' ? rows : rows.filter(r => r.temperature === (temp === 'warm' ? 'warm' : 'hot')).slice(0, limit);

    const header = 'id,host,platform,cat,title,created_at,temperature\n';
    const lines = filtered.map(r => {
      // basic CSV escaping
      const esc = (v: any) =>
        v == null ? '' : String(v).includes(',') || String(v).includes('"') ? `"${String(v).replace(/"/g, '""')}"` : String(v);
      const { lead, temperature } = r;
      return [
        esc(lead.id),
        esc(lead.host),
        esc(lead.platform),
        esc(lead.cat),
        esc(lead.title),
        esc(lead.created_at),
        esc(temperature),
      ].join(',');
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads_export.csv"');
    res.send(header + lines.join('\n'));
  });

  app.use('/api/v1/leads', r);
}
