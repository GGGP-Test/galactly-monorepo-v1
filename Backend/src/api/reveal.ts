import express from 'express';
import { q } from '../db';
import { clamp } from '../util';

type WhyItem = { label: string; kind: 'intent' | 'fit' | 'platform' | 'meta' | string; score: number; detail?: string };
type LeadRow = {
  id: number;
  cat: string | null;
  kw: string[] | null;
  platform: string | null;
  source_url: string | null;
  title: string | null;
  snippet: string | null;
  created_at: string;
};

function hostnameOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch { return null; }
}

function buildEvidence(lead: LeadRow): { host: string | null; why: WhyItem[] } {
  const host = hostnameOf(lead.source_url);
  const why: WhyItem[] = [];

  const hay = [lead.title ?? '', lead.snippet ?? ''].join(' ').toLowerCase();
  const kws = (Array.isArray(lead.kw) ? lead.kw : []).map(s => (s ?? '').toLowerCase());

  // ---- intent signals (no “cold” sources) ----
  const intentTerms = [
    'rfp','request for proposal','request for quote','rfq',
    'packaging','carton','boxes','labels','mailers','shipper',
    'fulfillment','3pl','warehouse','dc','distribution center',
    'rebrand','new product launch','sku expansion','co-packer'
  ];
  let intentScore = 0;
  for (const t of intentTerms) if (hay.includes(t)) intentScore += 0.12;
  for (const k of kws) if (intentTerms.some(t => k.includes(t))) intentScore += 0.1;
  intentScore = clamp(intentScore, 0, 1);
  if (intentScore > 0) why.push({ label: 'Intent evidence', kind: 'intent', score: intentScore });

  // ---- platform fit (e-com etc.) ----
  const platform = (lead.platform ?? '').toLowerCase();
  const ecomPlatforms = ['shopify','woocommerce','amazon','bigcommerce','magento','wix','squarespace'];
  const platformScore = ecomPlatforms.includes(platform) ? 0.6 : (platform ? 0.35 : 0);
  if (platformScore > 0) why.push({ label: 'Platform', kind: 'platform', score: platformScore, detail: platform || undefined });

  // ---- category fit ----
  const cat = (lead.cat ?? '').toLowerCase();
  const fitScore = cat === 'product' ? 0.5 : cat === 'procurement' ? 0.4 : 0.25;
  why.push({ label: 'Category fit', kind: 'fit', score: fitScore, detail: cat || undefined });

  // ---- domain quality (meta) ----
  if (host) {
    const tld = host.split('.').pop() || '';
    const dq = ['com','co','io','ai'].includes(tld) ? 0.6 : 0.3;
    why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host} (.${tld})` });
  }

  return { host, why };
}

function classifyTemperature(why: WhyItem[]): 'hot' | 'warm' {
  const intent = why.filter(w => w.kind === 'intent').reduce((a, w) => a + w.score, 0);
  const support = why.filter(w => w.kind !== 'intent').reduce((a, w) => a + w.score, 0);
  return intent >= 0.75 && support >= 0.6 ? 'hot' : 'warm';
}

async function checkRate(userId: string) {
  const lim = Number(process.env.REVEAL_LIMIT_10M ?? 3);
  const winMin = Number(process.env.REVEAL_WINDOW_MIN ?? 10);

  const r = await q<{ cnt: string; wait_sec: number }>(
    `WITH recent AS (
       SELECT created_at
       FROM event_log
       WHERE user_id=$1 AND event_type='reveal'
         AND created_at> now() - ($2::text||' minutes')::interval
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

export function mountReveal(app: express.Express) {
  app.get('/api/v1/reveal/ping', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.post('/api/v1/reveal', async (req, res) => {
    try {
      const userId = ((req as any).userId || req.header('x-galactly-user') || 'anon').toString();
      const { leadId, holdMs } = (req.body ?? {}) as { leadId?: number | string; holdMs?: number };

      const id = Number(leadId);
      if (!id || Number.isNaN(id)) return res.status(400).json({ ok: false, error: 'missing or invalid leadId' });

      const minHold = Number(process.env.REVEAL_MIN_HOLD_MS ?? 1100);
      if (typeof holdMs === 'number' && holdMs < minHold) {
        return res.status(400).json({ ok: false, error: 'hold too short', minHoldMs: minHold });
      }

      const gate = await checkRate(userId);
      if (!gate.ok) {
        return res.status(429).json({ ok: false, softBlock: true, nextInSec: gate.waitSec || 30, windowMin: gate.winMin, used: gate.count, limit: gate.lim });
      }

      const r = await q<LeadRow>(
        `SELECT id, cat, kw, platform, source_url, title, snippet, created_at
           FROM lead_pool
          WHERE id=$1
          LIMIT 1`, [id]
      );
      const lead = r.rows[0];
      if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });

      const { host, why } = buildEvidence(lead);
      const confidence = clamp(why.reduce((a, w) => a + (w.score || 0), 0) / Math.max(why.length || 1, 1), 0, 1);
      const temperature = classifyTemperature(why);

      await q(
        `INSERT INTO event_log(user_id, lead_id, event_type, meta)
         VALUES ($1,$2,'reveal',$3::jsonb)`,
        [userId, id, JSON.stringify({ holdMs: Number(holdMs || 0), temperature })]
      );

      res.json({
        ok: true,
        temperature,
        lead: { id: lead.id, platform: lead.platform, cat: lead.cat, host, title: lead.title || host, created_at: lead.created_at },
        why,
        packagingMath: {
          spendPerMonth: null,
          estOrdersPerMonth: null,
          estUnitsPerMonth: null,
          packagingTypeHint: lead.cat === 'product' ? 'cartons/labels' : (lead.cat === 'procurement' ? 'general packaging' : 'mixed'),
          confidence,
        }
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
