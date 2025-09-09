// Backend/src/routes/leads.ts
import express from 'express';
import { z } from 'zod';
import { q } from '../db';
import type { QueryResult } from 'pg';

// ---------- helpers ----------
const API_KEY_ENV =
  (process.env.API_KEY?.trim()) ||
  (process.env.ADMIN_KEY?.trim()) ||
  (process.env.ADMIN_TOKEN?.trim()) || '';

function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!API_KEY_ENV) return res.status(503).json({ ok: false, error: 'ingest disabled: no API_KEY/ADMIN_TOKEN set' });

  const hdr =
    (req.header('x-api-key') || req.header('x-admin-key') || '') ||
    ((req.header('authorization') || '').toLowerCase().startsWith('bearer ')
      ? (req.header('authorization') || '').slice(7).trim()
      : '');

  if ((hdr || '').trim() !== API_KEY_ENV) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

function hostFromUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return null;
  }
}

type Row = {
  id: string | number;
  cat: string | null;
  kw: string[] | null;
  platform: string | null;
  source_url: string | null;
  title: string | null;
  snippet?: string | null;
  created_at: string | Date | null;
};

type Why = { label: string; kind: 'meta' | 'platform' | 'signal'; score: number; detail: string };

function buildWhy(r: Row): { why: Why[]; temperature: 'hot' | 'warm'; host: string | null } {
  const why: Why[] = [];
  const host = hostFromUrl(r.source_url);

  // Domain quality
  if (host) {
    const tld = host.split('.').pop() || '';
    const dq = ['com', 'ca', 'co', 'io', 'ai', 'net', 'org'].includes(tld) ? 0.65 : 0.3;
    why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host} (.${tld})` });
  }

  // Platform
  const p = (r.platform || '').toLowerCase();
  if (p) {
    const pf = p === 'shopify' ? 0.75 : p === 'woocommerce' ? 0.6 : 0.5;
    why.push({ label: 'Platform fit', kind: 'platform', score: pf, detail: p });
  }

  // Intent keywords
  const kws = (r.kw || []).map(s => s.toLowerCase().trim()).filter(Boolean);
  const intentTerms = ['rfp', 'rfq', 'packaging', 'carton', 'mailers', 'labels', 'box', 'boxes'];
  const hit = kws.filter(k => intentTerms.includes(k));
  if (hit.length) {
    // stronger when it contains rfp/rfq
    const hasRfx = hit.some(k => k === 'rfp' || k === 'rfq');
    const sc = hasRfx ? 0.9 : 0.8;
    why.push({ label: 'Intent keywords', kind: 'signal', score: sc, detail: hit.join(', ') });
  }

  const avg = why.length ? (why.reduce((a, b) => a + b.score, 0) / why.length) : 0.0;
  const temperature: 'hot' | 'warm' = avg >= 0.7 ? 'hot' : 'warm';

  return { why, temperature, host };
}

function rowToLeadSummary(r: Row, temperature: 'hot' | 'warm', host: string | null) {
  return {
    id: String(r.id),
    platform: r.platform,
    cat: r.cat,
    host: host || hostFromUrl(r.source_url),
    title: r.title || (host || 'unknown'),
    created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    temperature,
  };
}

const stageEnum = z.enum(['new', 'qualified', 'outreach', 'engaged', 'won', 'lost', 'spam']);
type Stage = z.infer<typeof stageEnum>;

// ---------- router ----------
const router = express.Router();

// GET /api/v1/leads/:id  (detail + why/temperature)
router.get('/api/v1/leads/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: 'bad id' });

  try {
    const r = await q<Row>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool WHERE id=$1 LIMIT 1', [Number(id)]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

    const { why, temperature, host } = buildWhy(row);
    return res.json({
      ok: true,
      temperature,
      lead: rowToLeadSummary(row, temperature, host),
      why,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /api/v1/leads/hot?limit=10
router.get('/api/v1/leads/hot', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  try {
    const r = await q<Row>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool ORDER BY created_at DESC NULLS LAST LIMIT $1', [limit * 3]);
    const items = r.rows
      .map(row => {
        const { why, temperature, host } = buildWhy(row);
        return { row, why, temperature, host };
      })
      .filter(x => x.temperature === 'hot')
      .slice(0, limit)
      .map(x => ({
        ...rowToLeadSummary(x.row, x.temperature, x.host),
        why: x.why,
      }));

    return res.json({ ok: true, items });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /api/v1/leads/warm?limit=10
router.get('/api/v1/leads/warm', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  try {
    const r = await q<Row>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool ORDER BY created_at DESC NULLS LAST LIMIT $1', [limit * 3]);
    const items = r.rows
      .map(row => {
        const { why, temperature, host } = buildWhy(row);
        return { row, why, temperature, host };
      })
      .filter(x => x.temperature === 'warm')
      .slice(0, limit)
      .map(x => ({
        ...rowToLeadSummary(x.row, x.temperature, x.host),
        why: x.why,
      }));

    return res.json({ ok: true, items });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/v1/leads/ingest  (single)
router.post('/api/v1/leads/ingest', requireApiKey, async (req, res) => {
  const schema = z.object({
    cat: z.string().default('product'),
    kw: z.array(z.string()).default([]),
    platform: z.string().optional().default(''),
    source_url: z.string().url(),
    title: z.string().optional().default(''),
    snippet: z.string().optional().default(''),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'bad_payload', issues: parsed.error.issues });

  const v = parsed.data;
  try {
    const ins = await q<Row>(
      `INSERT INTO lead_pool(cat, kw, platform, source_url, title, snippet)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, cat, kw, platform, source_url, title, snippet, created_at`,
      [v.cat, v.kw, v.platform, v.source_url, v.title, v.snippet]
    );
    const row = ins.rows[0];
    const { why, temperature, host } = buildWhy(row);
    return res.json({ ok: true, temperature, lead: rowToLeadSummary(row, temperature, host), why });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/v1/leads/ingest/bulk  (array)
router.post('/api/v1/leads/ingest/bulk', requireApiKey, async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ ok: false, error: 'expected array' });

  const schema = z.object({
    cat: z.string().default('product'),
    kw: z.array(z.string()).default([]),
    platform: z.string().optional().default(''),
    source_url: z.string().url(),
    title: z.string().optional().default(''),
    snippet: z.string().optional().default(''),
  });

  const items = [];
  for (const it of req.body) {
    const p = schema.safeParse(it);
    if (!p.success) continue;
    items.push(p.data);
  }
  if (!items.length) return res.json({ ok: true, inserted: 0, items: [] });

  try {
    const out: any[] = [];
    for (const v of items) {
      const ins = await q<Row>(
        `INSERT INTO lead_pool(cat, kw, platform, source_url, title, snippet)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, cat, kw, platform, source_url, title, snippet, created_at`,
        [v.cat, v.kw, v.platform, v.source_url, v.title, v.snippet]
      );
      const row = ins.rows[0];
      const { why, temperature, host } = buildWhy(row);
      out.push({ ...rowToLeadSummary(row, temperature, host), temperature, why });
    }
    return res.json({ ok: true, inserted: out.length, items: out });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PATCH /api/v1/leads/:id/stage  { stage: 'qualified' | ... }
router.patch('/api/v1/leads/:id/stage', requireApiKey, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: 'bad id' });

  const body = z.object({ stage: stageEnum }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ ok: false, error: 'bad_payload', issues: body.error.issues });

  try {
    await q('INSERT INTO lead_meta(lead_id, stage) VALUES ($1,$2) ON CONFLICT (lead_id) DO UPDATE SET stage=EXCLUDED.stage', [
      Number(id),
      body.data.stage,
    ]);
    return res.json({ ok: true, id, stage: body.data.stage });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/v1/leads/:id/notes  { note: "..." }  (appends with timestamp)
router.post('/api/v1/leads/:id/notes', requireApiKey, async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: 'bad id' });

  const body = z.object({ note: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ ok: false, error: 'bad_payload', issues: body.error.issues });

  try {
    const ts = new Date().toISOString();
    await q(
      `INSERT INTO lead_meta(lead_id, notes) VALUES ($1, $2)
       ON CONFLICT (lead_id) DO UPDATE SET notes =
         CASE
           WHEN lead_meta.notes IS NULL OR lead_meta.notes = '' THEN EXCLUDED.notes
           ELSE lead_meta.notes || E'\n' || EXCLUDED.notes
         END`,
      [Number(id), `[${ts}] ${body.data.note}`]
    );
    const r = await q<{ stage: Stage | null; notes: string | null }>('SELECT stage, notes FROM lead_meta WHERE lead_id=$1', [Number(id)]);
    return res.json({ ok: true, id, stage: r.rows[0]?.stage || 'new', notes: r.rows[0]?.notes || '' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /api/v1/leads/export.csv?temperature=hot|warm&limit=100
router.get('/api/v1/leads/export.csv', async (req, res) => {
  const temp = String(req.query.temperature || '').toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);

  try {
    const r = await q<Row>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool ORDER BY created_at DESC NULLS LAST LIMIT $1', [limit * 3]);
    const rows = r.rows.map(row => {
      const { why, temperature, host } = buildWhy(row);
      return { row, why, temperature, host };
    });

    const filtered = temp === 'hot' || temp === 'warm' ? rows.filter(x => x.temperature === temp) : rows;
    const list = filtered.slice(0, limit);

    // Build CSV (no external deps)
    const esc = (s: any) => {
      const t = (s === null || s === undefined) ? '' : String(s);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };

    const header = [
      'id', 'temperature', 'platform', 'cat', 'host',
      'title', 'created_at', 'source_url', 'why_labels', 'why_scores'
    ].join(',');

    const lines = [header];
    for (const it of list) {
      const lead = rowToLeadSummary(it.row, it.temperature, it.host);
      const labels = it.why.map(w => w.label).join('|');
      const scores = it.why.map(w => w.score.toFixed(2)).join('|');
      lines.push([
        esc(lead.id),
        esc(lead.temperature),
        esc(lead.platform),
        esc(lead.cat),
        esc(lead.host),
        esc(lead.title),
        esc(lead.created_at),
        esc((it.row.source_url || '')),
        esc(labels),
        esc(scores),
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${temp || 'all'}.csv"`);
    return res.status(200).send(lines.join('\n'));
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default function registerLeadsRoutes(app: express.Express) {
  // Important: mount this *before* any greedy /:id patterns in other routers
  app.use(router);
}
