// Backend/src/routes/leads.ts
import express from 'express';
import { q } from '../db';

type LeadRow = {
  id: number;
  cat: string;
  kw: string[] | null;
  platform: string | null;
  source_url: string | null;
  title: string | null;
  snippet: string | null;
  created_at: string;
};

function hostFrom(url?: string | null) {
  try { return url ? new URL(url).host || null : null; } catch { return null; }
}
function tldScore(host: string | null) {
  if (!host) return 0.3;
  const tld = host.split('.').pop()?.toLowerCase() ?? '';
  return ['com','co','io','ai','ca'].includes(tld) ? 0.65 : 0.3;
}
function platformScore(p?: string | null) {
  if (!p) return 0.4;
  const m: Record<string, number> = { shopify: 0.75, woocommerce: 0.6, magento: 0.6, bigcommerce: 0.6 };
  return m[String(p).toLowerCase()] ?? 0.5;
}
const INTENT = ['rfp','rfq','packaging','carton','labels','mailer','mailers','box','boxes'];
function intentScore(kw: string[] | null | undefined) {
  const hay = (kw || []).map(s => String(s).toLowerCase());
  const hits = INTENT.filter(w => hay.includes(w)).length;
  if (hits >= 3) return 0.9;
  if (hits === 2) return 0.8;
  if (hits === 1) return 0.6;
  return 0.2;
}
function buildWhy(row: LeadRow) {
  const host = hostFrom(row.source_url);
  const why = [
    { label: 'Domain quality', kind: 'meta',     score: tldScore(host),              detail: host ? `${host} (.${host.split('.').pop()})` : 'n/a' },
    { label: 'Platform fit',   kind: 'platform', score: platformScore(row.platform), detail: String(row.platform || '') },
    { label: 'Intent keywords',kind: 'signal',   score: intentScore(row.kw || []),   detail: (row.kw || []).join(', ') }
  ];
  const confidence = Math.max(0, Math.min(1, why.reduce((a, w) => a + w.score, 0) / (why.length || 1)));
  const temperature = confidence >= 0.75 ? 'hot' : (confidence >= 0.5 ? 'warm' : 'cold');
  return { host, why, confidence, temperature: temperature as 'hot' | 'warm' | 'cold' };
}

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const want = process.env.API_KEY?.trim();
  if (!want) return res.status(503).json({ ok:false, error:'ingest disabled: missing API_KEY' });
  const got = String(req.header('x-api-key') || '').trim();
  if (got !== want) return res.status(401).json({ ok:false, error:'unauthorized' });
  next();
}

const router = express.Router();

/* ------------------------------ LISTS (static first) ------------------------------ */
router.get('/hot', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20), 100));
    const r = await q<LeadRow>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool ORDER BY created_at DESC LIMIT $1', [limit * 5]);
    const items = r.rows
      .map(row => {
        const s = buildWhy(row);
        return { id: String(row.id), platform: row.platform, cat: row.cat, host: s.host, title: row.title || s.host, created_at: row.created_at, temperature: s.temperature, why: s.why };
      })
      .filter(it => it.temperature === 'hot')
      .slice(0, limit);
    res.json({ ok: true, items });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get('/warm', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20), 100));
    const r = await q<LeadRow>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool ORDER BY created_at DESC LIMIT $1', [limit * 5]);
    const items = r.rows
      .map(row => {
        const s = buildWhy(row);
        return { id: String(row.id), platform: row.platform, cat: row.cat, host: s.host, title: row.title || s.host, created_at: row.created_at, temperature: s.temperature, why: s.why };
      })
      .filter(it => it.temperature === 'warm')
      .slice(0, limit);
    res.json({ ok: true, items });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ------------------------------ INGEST (auth) ------------------------------ */
// Single row
router.post('/ingest', requireApiKey, async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ['cat','kw','platform','source_url','title','snippet'] as const;

    // Build dynamic INSERT (with or without id)
    const hasId = typeof b.id === 'number' || /^\d+$/.test(String(b.id || ''));
    const cols = [...(hasId ? ['id'] : []), ...fields];
    const vals = [...(hasId ? [Number(b.id)] : []), b.cat, b.kw ?? [], b.platform ?? null, b.source_url ?? null, b.title ?? null, b.snippet ?? null];

    const placeholders = cols.map((_, i) => `$${i+1}`).join(',');
    const sql = `INSERT INTO lead_pool (${cols.join(',')}) VALUES (${placeholders}) RETURNING id, cat, kw, platform, source_url, title, snippet, created_at`;
    const r = await q<LeadRow>(sql, vals);

    const row = r.rows[0];
    const s = buildWhy(row);
    res.json({
      ok: true,
      temperature: s.temperature,
      lead: { id: String(row.id), platform: row.platform, cat: row.cat, host: s.host, title: row.title || s.host, created_at: row.created_at },
      why: s.why
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Bulk rows
router.post('/ingest/bulk', requireApiKey, async (req, res) => {
  try {
    const arr: any[] = Array.isArray(req.body) ? req.body : [];
    if (!arr.length) return res.status(400).json({ ok:false, error:'empty payload' });

    const out: any[] = [];
    for (const b of arr) {
      const hasId = typeof b.id === 'number' || /^\d+$/.test(String(b.id || ''));
      const cols = [...(hasId ? ['id'] : []), 'cat','kw','platform','source_url','title','snippet'];
      const vals = [...(hasId ? [Number(b.id)] : []), b.cat, b.kw ?? [], b.platform ?? null, b.source_url ?? null, b.title ?? null, b.snippet ?? null];
      const placeholders = cols.map((_, i) => `$${i+1}`).join(',');
      const sql = `INSERT INTO lead_pool (${cols.join(',')}) VALUES (${placeholders}) RETURNING id, cat, kw, platform, source_url, title, snippet, created_at`;
      const r = await q<LeadRow>(sql, vals);
      const row = r.rows[0];
      const s = buildWhy(row);
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
    res.json({ ok:true, inserted: out.length, items: out });
  } catch (e: any) {
    res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

/* ------------------------------ DETAIL (param last) ------------------------------ */
router.get('/:id', async (req, res) => {
  const idStr = String(req.params.id || '').trim();
  if (!/^\d+$/.test(idStr)) return res.status(404).json({ ok: false, error: 'not_found' });

  try {
    const r = await q<LeadRow>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool WHERE id=$1 LIMIT 1', [Number(idStr)]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ ok:false, error:'not_found' });

    const s = buildWhy(row);
    res.json({
      ok: true,
      temperature: s.temperature,
      lead: { id: String(row.id), platform: row.platform, cat: row.cat, host: s.host, title: row.title || s.host, created_at: row.created_at },
      why: s.why
    });
  } catch (e:any) {
    res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

export const leadsRouter = router;
export default router;
export function mountLeads(app: express.Express){ app.use('/api/v1/leads', router); }
