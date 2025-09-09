import express from 'express';
import { q } from '../db';

type LeadRow = {
  id: number | string;
  cat: string | null;
  kw: string[] | null;
  platform: string | null;
  source_url: string | null;
  title: string | null;
  snippet: string | null;
  created_at: string;
};

type Why = { label: string; kind: 'meta'|'platform'|'signal'; score: number; detail: string };

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

function hostFrom(url?: string | null): string | undefined {
  if (!url) return;
  try { return new URL(url).host.toLowerCase(); } catch { return; }
}

function scorePlatform(p?: string | null): number {
  if (!p) return 0.3;
  const m = p.toLowerCase();
  if (['shopify','woocommerce','bigcommerce','magento','squarespace'].includes(m)) return 0.75;
  if (['etsy','amazon','ebay'].includes(m)) return 0.6;
  return 0.5;
}

function scoreDomainQuality(host?: string): number {
  if (!host) return 0.3;
  const tld = host.split('.').pop() || '';
  if (['com','io','ai','co','ca','net','org'].includes(tld)) return 0.65;
  return 0.3;
}

function scoreIntent(kw?: string[] | null): { s: number; detail: string } {
  const bag = (kw ?? []).map(k => k.toLowerCase());
  const hits = ['packaging','carton','boxes','labels','rfp','rfq','tender'].filter(k => bag.includes(k));
  if (!hits.length) return { s: 0.4, detail: '' };
  const s = clamp(0.6 + 0.1 * Math.min(hits.length, 4), 0, 0.95);
  return { s, detail: hits.join(', ') };
}

function temperature(avg: number): 'hot'|'warm' {
  return avg >= 0.7 ? 'hot' : 'warm';
}

function buildWhy(lead: LeadRow) {
  const host = hostFrom(lead.source_url);
  const why: Why[] = [];

  const dq = scoreDomainQuality(host);
  why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host ?? 'n/a'} (${host?.split('.').pop()?.toUpperCase() ?? '-'})` });

  const pf = scorePlatform(lead.platform);
  why.push({ label: 'Platform fit', kind: 'platform', score: pf, detail: String(lead.platform ?? 'unknown') });

  const { s: ik, detail } = scoreIntent(lead.kw);
  if (detail) why.push({ label: 'Intent keywords', kind: 'signal', score: ik, detail });

  return { host, why };
}

async function checkRate(userId: string) {
  const lim = Number(process.env.REVEAL_LIMIT_10M ?? 3);
  const winMin = Number(process.env.REVEAL_WINDOW_MIN ?? 10);

  await q(`
    CREATE TABLE IF NOT EXISTS event_log(
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      lead_id BIGINT NULL,
      meta JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_event_time ON event_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_user ON event_log(user_id);
  `);

  const r = await q<{ cnt: string; wait_sec: number }>(
    `WITH recent AS (
       SELECT created_at FROM event_log
       WHERE user_id = $1
         AND event_type = 'reveal'
         AND created_at > now() - ($2::text || ' minutes')::interval
     )
     SELECT COUNT(*)::text AS cnt,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM ((MIN(created_at) + ($2::text||' minutes')::interval) - now())))) AS wait_sec
       FROM recent`,
    [userId, String(winMin)]
  );

  const count = Number(r.rows[0]?.cnt ?? 0);
  const waitSec = Number(r.rows[0]?.wait_sec ?? 0);
  const ok = count < lim;
  return { ok, count, lim, waitSec, winMin };
}

async function fetchLead(id: number): Promise<LeadRow | undefined> {
  const r = await q<LeadRow>(
    `SELECT id, cat, kw, platform, source_url, title, snippet, created_at
       FROM lead_pool
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return r.rows[0];
}

export function mountReveal(app: express.Express) {
  const r = express.Router();

  // POST /api/v1/reveal  (existing behavior)
  r.post('/', async (req, res) => {
    try {
      const userId = (req as any).userId ?? 'anon';
      const { leadId, holdMs } = (req.body ?? {}) as { leadId?: number; holdMs?: number };
      if (!leadId) return res.status(400).json({ ok: false, error: 'missing leadId' });

      const minHold = Number(process.env.REVEAL_MIN_HOLD_MS ?? 1100);
      if (typeof holdMs === 'number' && holdMs < minHold) {
        return res.status(400).json({ ok: false, error: 'hold too short', minHoldMs: minHold });
      }

      const gate = await checkRate(userId);
      if (!gate.ok) {
        return res.status(429).json({ ok: false, softBlock: true, nextInSec: gate.waitSec || 30, windowMin: gate.winMin, used: gate.count, limit: gate.lim });
      }

      const lead = await fetchLead(Number(leadId));
      if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });

      const { host, why } = buildWhy(lead);
      const avg = why.reduce((a, w) => a + w.score, 0) / (why.length || 1);
      const packagingMath = {
        spendPerMonth: null as number | null,
        estOrdersPerMonth: null as number | null,
        estUnitsPerMonth: null as number | null,
        packagingTypeHint: lead.cat === 'product' ? 'cartons/labels' : (lead.cat === 'procurement' ? 'general packaging' : 'mixed'),
        confidence: clamp(avg, 0, 1),
      };

      await q('INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)', [userId, Number(lead.id), 'reveal', { holdMs: Number(holdMs || 0) } as any]);

      res.json({
        ok: true,
        temperature: temperature(avg),
        lead: {
          id: String(lead.id),
          platform: lead.platform,
          cat: lead.cat,
          host,
          title: lead.title || host,
          created_at: lead.created_at,
        },
        why,
        packagingMath,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // GET /api/v1/reveal/:id (convenience form)
  r.get('/:id', async (req, res) => {
    req.body = { leadId: Number(req.params.id), holdMs: 1500 };
    return (r as any).handle(req, res); // reuse POST handler
  });

  // POST /api/v1/reveal/batch { ids: number[] }
  r.post('/batch', async (req, res) => {
    try {
      const ids = (req.body?.ids ?? []) as number[];
      if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ ok: false, error: 'missing ids[]' });
      const out = [];
      for (const id of ids) {
        const lead = await fetchLead(Number(id));
        if (!lead) { out.push({ id, ok: false, error: 'not_found' }); continue; }
        const { host, why } = buildWhy(lead);
        const avg = why.reduce((a, w) => a + w.score, 0) / (why.length || 1);
        out.push({
          id,
          ok: true,
          temperature: temperature(avg),
          lead: { id: String(lead.id), platform: lead.platform, cat: lead.cat, host, title: lead.title || host, created_at: lead.created_at },
          why,
        });
      }
      res.json({ ok: true, items: out });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Debug: DB info + presence of id 123
  r.get('/_debug/dbinfo', async (_req, res) => {
    try {
      const info = await q<{ current_database: string; current_user: string; current_schema: string }>(
        `SELECT current_database(), current_user, current_schema`
      );
      const has = await q(`SELECT 1 FROM lead_pool WHERE id=123 LIMIT 1`);
      res.json({ ok: true, db: { db: info.rows[0].current_database, user: info.rows[0].current_user, schema: info.rows[0].current_schema }, has_123: !!has.rowCount });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.use('/api/v1/reveal', r);
}
