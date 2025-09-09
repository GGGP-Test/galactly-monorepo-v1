// Backend/src/api/reveal.ts
import type express from 'express';
import { q } from '../db';

type WhyItem = { label: string; kind: 'meta'|'signal'|'platform'; score: number; detail?: string };
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

function hostOf(url?: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function buildWhy(lead: any): { host: string | null; why: WhyItem[] } {
  const why: WhyItem[] = [];
  const host = hostOf(lead?.source_url);

  if (host) {
    const tld = host.split('.').pop() || '';
    const dq = ['com','ca','co','io','ai','net','org'].includes(tld) ? 0.65 : 0.35;
    why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host} (.${tld})` });
  }

  const pf = String(lead?.platform || '').toLowerCase();
  if (pf) {
    const base =
      pf.includes('shopify') ? 0.75 :
      pf.includes('reddit')  ? 0.55 :
      pf.includes('youtube') ? 0.5  :
      pf.includes('pdp')     ? 0.7  :
      0.5;
    why.push({ label: 'Platform fit', kind: 'platform', score: base, detail: pf });
  }

  const kws: string[] = Array.isArray(lead?.kw) ? lead.kw : [];
  const intentWords = ['rfp','rfq','packaging','carton','boxes','labels','supplier','quote','sourcing'];
  const hits = kws.map(k => String(k).toLowerCase()).filter(k => intentWords.some(w => k.includes(w)));
  if (hits.length) {
    const bonus = clamp(0.15 + 0.05 * Math.min(hits.length, 5));
    why.push({ label: 'Intent keywords', kind: 'signal', score: clamp(0.6 + bonus), detail: hits.join(', ') });
  }

  return { host, why };
}

async function checkRate(userId: string) {
  const lim = Number(process.env.REVEAL_LIMIT_10M ?? 3);
  const winMin = Number(process.env.REVEAL_WINDOW_MIN ?? 10);
  const r = await q<{ cnt: string; wait_sec: string }>(`
    WITH recent AS (
      SELECT created_at
      FROM event_log
      WHERE user_id = $1
        AND event_type = 'reveal'
        AND created_at > now() - ($2::text || ' minutes')::interval
    )
    SELECT COUNT(*)::text AS cnt,
           GREATEST(0, CEIL(EXTRACT(EPOCH FROM ((MIN(created_at) + ($2::text||' minutes')::interval) - now()))))::text AS wait_sec
    FROM recent
  `, [userId, String(winMin)]);
  const count = Number(r.rows[0]?.cnt ?? 0);
  const waitSec = Number(r.rows[0]?.wait_sec ?? 0);
  return { ok: count < lim, count, lim, waitSec, winMin };
}

export function mountReveal(app: express.Express) {
  app.get('/api/v1/reveal/ping', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.post('/api/v1/reveal', async (req, res) => {
    try {
      const userId = (req as any).userId || 'anon';
      const { leadId, holdMs } = (req.body ?? {}) as { leadId?: number | string; holdMs?: number };
      if (!leadId) return res.status(400).json({ ok: false, error: 'missing leadId' });

      const minHold = Number(process.env.REVEAL_MIN_HOLD_MS ?? 1100);
      if (typeof holdMs === 'number' && holdMs < minHold) {
        return res.status(400).json({ ok: false, error: 'hold too short', minHoldMs: minHold });
      }

      const gate = await checkRate(userId);
      if (!gate.ok) {
        return res.status(429).json({
          ok: false, softBlock: true,
          nextInSec: gate.waitSec || 30, windowMin: gate.winMin,
          used: gate.count, limit: gate.lim
        });
      }

      const r = await q<any>(`
        SELECT id, cat, kw, platform, source_url, title, snippet, created_at
        FROM lead_pool
        WHERE id = $1
        LIMIT 1
      `, [Number(leadId)]);
      const lead = r.rows[0];
      if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });

      const { host, why } = buildWhy(lead);
      const evidenceScore = why.length ? clamp(why.reduce((a, w) => a + w.score, 0) / why.length, 0, 1) : 0.4;
      const temperature: 'hot' | 'warm' | 'cold' =
        evidenceScore >= 0.72 ? 'hot' : evidenceScore >= 0.55 ? 'warm' : 'cold';

      const packagingMath = {
        spendPerMonth: null as number | null,
        estOrdersPerMonth: null as number | null,
        estUnitsPerMonth: null as number | null,
        packagingTypeHint:
          lead.cat === 'product' ? 'cartons/labels' :
          lead.cat === 'procurement' ? 'general packaging' : 'mixed',
        confidence: evidenceScore
      };

      await q('INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)',
        [userId, Number(leadId), 'reveal', { holdMs: Number(holdMs || 0) } as any]);

      res.json({
        ok: true,
        temperature,
        lead: {
          id: lead.id,
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

  // ---- TEMP DEBUG (to verify DB binding) ----
  app.get('/api/v1/reveal/_debug/dbinfo', async (_req, res) => {
    try {
      const info = await q<any>(`SELECT current_database() AS db, current_user AS "user", current_schema AS schema`);
      const has = await q<any>(`SELECT EXISTS(SELECT 1 FROM lead_pool WHERE id=123) AS has_123`);
      res.json({ ok: true, db: info.rows[0], has_123: !!has.rows[0]?.has_123 });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
