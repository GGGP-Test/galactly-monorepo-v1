// Backend/src/api/reveal.ts
import type express from 'express';
import { Pool } from 'pg';

// --- DB helper --------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function q<T = any>(text: string, params: any[] = []) {
  const c = await pool.connect();
  try {
    const r = await c.query<T>(text, params as any);
    return r as any;
  } finally {
    c.release();
  }
}

// --- small utils ------------------------------------------------------------
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function hostFromUrl(u?: string | null): string | null {
  try {
    if (!u) return null;
    const h = new URL(u).hostname;
    return h || null;
  } catch (_e) {
    return null;
  }
}

type Why = { label: string; kind: 'meta' | 'platform' | 'signal'; score: number; detail?: string };

function buildWhy(lead: any) {
  const why: Why[] = [];

  const host = hostFromUrl(lead?.source_url) || null;
  if (host) {
    const tld = host.split('.').pop() || '';
    const dq = ['com', 'ca', 'co', 'io', 'ai', 'net', 'org'].includes(tld) ? 0.65 : 0.35;
    why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host} (.${tld})` });
  }

  const platform = String(lead?.platform || '').toLowerCase();
  if (platform) {
    const pf = ['shopify', 'woocommerce', 'bigcommerce'].includes(platform) ? 0.75 : 0.4;
    why.push({ label: 'Platform fit', kind: 'platform', score: pf, detail: platform });
  }

  const kw: string[] = Array.isArray(lead?.kw) ? lead.kw : [];
  const hasIntent = kw.some(k => ['packaging', 'carton', 'rfp', 'rfq', 'labels'].includes(String(k).toLowerCase()));
  if (kw.length) {
    why.push({
      label: 'Intent keywords',
      kind: 'signal',
      score: hasIntent ? 0.9 : 0.5,
      detail: kw.join(', ')
    });
  }

  return { host, why };
}

function temperatureFromWhy(why: Why[]): 'hot' | 'warm' | 'cold' {
  const s = avg(why.map(w => clamp(w.score)));
  if (s >= 0.75) return 'hot';
  if (s >= 0.5) return 'warm';
  return 'cold';
}

// --- handlers ---------------------------------------------------------------
async function fetchLeadById(id: number) {
  const r = await q(
    'SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool WHERE id=$1 LIMIT 1',
    [id]
  );
  return (r.rows && (r as any).rows[0]) || null;
}

export function mountReveal(app: express.Express) {
  // health for this group
  app.get('/api/v1/reveal/ping', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // debug db info (safe)
  app.get('/api/v1/reveal/_debug/dbinfo', async (_req, res) => {
    try {
      const info = await q<{ current_database: string; current_user: string; current_schema: string }>(
        'SELECT current_database(), current_user, current_schema'
      );
      const has123 = await q('SELECT 1 FROM lead_pool WHERE id=123 LIMIT 1');
      res.json({
        ok: true,
        db: {
          db: (info as any).rows?.[0]?.current_database || null,
          user: (info as any).rows?.[0]?.current_user || null,
          schema: (info as any).rows?.[0]?.current_schema || null
        },
        has_123: !!(has123 as any).rowCount
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // POST /reveal
  app.post('/api/v1/reveal', async (req, res) => {
    try {
      const leadId = Number(req.body?.leadId);
      const holdMs = Number(req.body?.holdMs || 0);
      if (!leadId) return res.status(400).json({ ok: false, error: 'missing leadId' });

      const minHold = Number(process.env.REVEAL_MIN_HOLD_MS || 1100);
      if (holdMs && holdMs < minHold) {
        return res.status(400).json({ ok: false, error: 'hold too short', minHoldMs: minHold });
      }

      const lead = await fetchLeadById(leadId);
      if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });

      const { host, why } = buildWhy(lead);
      const temperature = temperatureFromWhy(why);

      const packagingMath = {
        spendPerMonth: null as number | null,
        estOrdersPerMonth: null as number | null,
        estUnitsPerMonth: null as number | null,
        packagingTypeHint:
          lead.cat === 'product'
            ? 'cartons/labels'
            : lead.cat === 'procurement'
            ? 'general packaging'
            : 'mixed',
        confidence: clamp(avg(why.map(w => w.score)), 0, 1)
      };

      res.json({
        ok: true,
        temperature,
        lead: {
          id: String(lead.id),
          platform: lead.platform,
          cat: lead.cat,
          host,
          title: lead.title || host,
          created_at: lead.created_at
        },
        why,
        packagingMath
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // GET /reveal/:id  (convenience)
  app.get('/api/v1/reveal/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: 'bad id' });

      // call the same logic as POST
      const fakeReq: any = { body: { leadId: id, holdMs: Number(req.query.holdMs || 1500) } };
      // @ts-ignore reuse handler
      return (app._router.stack
        ?.flatMap((l: any) => [l.route]?.filter(Boolean))
        ?.find((r: any) => r?.path === '/api/v1/reveal' && r?.methods?.post)
        ?.stack?.[0]?.handle || ((_rq: any, rs: any) => rs.status(500).json({ ok: false, error: 'handler missing' })))(
        fakeReq,
        res
      );
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
