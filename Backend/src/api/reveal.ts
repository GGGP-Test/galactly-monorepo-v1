// Backend/src/api/reveal.ts
import type express from 'express';
import { q } from '../db';

type LeadRow = {
  id: number | string;
  cat: string | null;
  kw?: string[] | null;
  platform?: string | null;
  source_url?: string | null;
  title?: string | null;
  snippet?: string | null;
  created_at?: string | Date | null;
};

type Why = { label: string; kind: 'meta'|'platform'|'signal'; score: number; detail: string };

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

function domainOf(u?: string | null): string | null {
  if (!u) return null;
  try { return new URL(u).hostname || null; } catch { return null; }
}

function buildWhy(lead: LeadRow): { host: string | null; why: Why[] } {
  const host = domainOf(lead.source_url);
  const why: Why[] = [];

  // Domain quality
  if (host) {
    const tld = host.split('.').pop() ?? '';
    const dq = ['com','ca','co','io','ai','dev','net','org'].includes(tld) ? 0.65 : 0.35;
    why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host} (.${tld})` });
  }

  // Platform fit
  const platform = (lead.platform ?? '').toLowerCase();
  if (platform) {
    const pf = platform === 'shopify' ? 0.75
             : ['woocommerce','bigcommerce','magento'].includes(platform) ? 0.6
             : 0.4;
    why.push({ label: 'Platform fit', kind: 'platform', score: pf, detail: platform });
  }

  // Intent keywords
  const kw = (lead.kw ?? []) as string[];
  if (kw.length) {
    const intent = ['packaging','carton','rfp','rfq','labels','shipping','fulfillment'];
    const hits = kw.filter(k => intent.includes(k.toLowerCase()));
    const score = clamp(hits.length / Math.max(kw.length, 1), 0.3, 0.9);
    why.push({ label: 'Intent keywords', kind: 'signal', score, detail: kw.join(', ') });
  }

  return { host, why };
}

function temperatureOf(why: Why[]): 'hot'|'warm' {
  const avg = why.reduce((a, w) => a + w.score, 0) / Math.max(why.length, 1);
  return avg >= 0.65 ? 'hot' : 'warm';
}

async function checkRate(userId: string) {
  const lim = Number(process.env.REVEAL_LIMIT_10M ?? 3);
  const winMin = Number(process.env.REVEAL_WINDOW_MIN ?? 10);
  const r = await q<{ cnt: string; wait_sec: number }>(
    `WITH recent AS (
       SELECT created_at FROM event_log
       WHERE user_id=$1 AND event_type='reveal' AND created_at> now() - ($2::text||' minutes')::interval
     )
     SELECT COUNT(*)::text AS cnt,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM ((MIN(created_at) + ($2::text||' minutes')::interval) - now())))) AS wait_sec
       FROM recent`,
    [userId, String(winMin)]
  );
  const count = Number(r.rows[0]?.cnt ?? 0);
  const waitSec = Number(r.rows[0]?.wait_sec ?? 0);
  return { ok: count < lim, count, lim, waitSec, winMin };
}

async function loadLeadById(id: number) {
  const r = await q<LeadRow>(
    `SELECT id, cat, kw, platform, source_url, title, snippet, created_at
       FROM lead_pool
      WHERE id=$1 LIMIT 1`, [id]
  );
  return r.rows[0];
}

async function makeRevealPayload(userId: string, id: number, holdMs?: number) {
  // optional hold-to-reveal
  const minHold = Number(process.env.REVEAL_MIN_HOLD_MS ?? 1100);
  if (typeof holdMs === 'number' && holdMs < minHold) {
    return { status: 400, body: { ok: false, error: 'hold too short', minHoldMs: minHold } };
  }

  // rate limit
  const gate = await checkRate(userId);
  if (!gate.ok) {
    return { status: 429, body: { ok: false, softBlock: true, nextInSec: gate.waitSec, windowMin: gate.winMin, used: gate.count, limit: gate.lim } };
  }

  const lead = await loadLeadById(id);
  if (!lead) return { status: 404, body: { ok: false, error: 'lead not found' } };

  const { host, why } = buildWhy(lead);
  const temperature = temperatureOf(why);

  const packagingMath = {
    spendPerMonth: null as number | null,
    estOrdersPerMonth: null as number | null,
    estUnitsPerMonth: null as number | null,
    packagingTypeHint: lead.cat === 'product' ? 'cartons/labels' : (lead.cat === 'procurement' ? 'general packaging' : 'mixed'),
    confidence: clamp(why.reduce((a,w)=>a+w.score,0)/(why.length||1), 0, 1),
  };

  // log event (best effort)
  await q('INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)',
          [userId, Number(lead.id), 'reveal', { holdMs: Number(holdMs||0) } as any]).catch(()=>{});

  return {
    status: 200,
    body: {
      ok: true,
      temperature,
      lead: {
        id: String(lead.id),
        platform: lead.platform ?? null,
        cat: lead.cat ?? null,
        host,
        title: lead.title ?? host ?? null,
        created_at: lead.created_at ? new Date(lead.created_at as any).toISOString() : null,
      },
      why,
      packagingMath,
    }
  };
}

export function mountReveal(app: express.Express) {
  // basic ping
  app.get('/api/v1/reveal/ping', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // debug: show DB info + check seed id
  app.get('/api/v1/reveal/_debug/dbinfo', async (_req, res) => {
    try {
      const meta = await q<{ db: string; user: string; schema: string }>(
        `SELECT current_database() AS db, current_user AS user, current_schema() AS schema`
      );
      const r123 = await q('SELECT 1 FROM lead_pool WHERE id=123 LIMIT 1');
      res.json({ ok: true, db: meta.rows[0], has_123: !!r123.rowCount });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // NEW: GET by id
  app.get('/api/v1/reveal/:id', async (req, res) => {
    try {
      const userId = (req as any).userId ?? 'anon';
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
      const r = await makeRevealPayload(userId, id);
      res.status(r.status).json(r.body);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // POST (existing): { leadId, holdMs }
  app.post('/api/v1/reveal', async (req, res) => {
    try {
      const userId = (req as any).userId ?? 'anon';
      const { leadId, holdMs } = (req.body ?? {}) as { leadId?: number; holdMs?: number };
      if (!Number.isFinite(Number(leadId))) return res.status(400).json({ ok: false, error: 'missing leadId' });
      const r = await makeRevealPayload(userId, Number(leadId), holdMs);
      res.status(r.status).json(r.body);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
