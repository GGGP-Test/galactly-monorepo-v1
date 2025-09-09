// src/api/reveal.ts
import express from 'express';
import { q } from '../db';
import { clamp } from '../util';
import { buildWhy } from '../why';

// --- types used in responses ---
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

// --- small helpers ---
function hostnameOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return null;
  }
}

async function checkRate(userId: string) {
  const lim = Number(process.env.REVEAL_LIMIT_10M ?? 3);
  const winMin = Number(process.env.REVEAL_WINDOW_MIN ?? 10);

  const r = await q<{ cnt: string; wait_sec: number }>(
    `WITH recent AS (
       SELECT created_at
       FROM event_log
       WHERE user_id = $1
         AND event_type = 'reveal'
         AND created_at > now() - ($2::text || ' minutes')::interval
     )
     SELECT COUNT(*)::text AS cnt,
            GREATEST(
              0,
              CEIL(EXTRACT(EPOCH FROM ((MIN(created_at) + ($2::text || ' minutes')::interval) - now())))
            ) AS wait_sec
     FROM recent`,
    [userId, String(winMin)]
  );

  const count = Number(r.rows[0]?.cnt ?? 0);
  const waitSec = Number(r.rows[0]?.wait_sec ?? 0);
  const ok = count < lim;
  return { ok, count, lim, waitSec, winMin };
}

function classifyTemperature(why: WhyItem[]): 'hot' | 'warm' {
  // “Hot” if intent evidence is strong; otherwise “Warm”.
  // You can tune these thresholds/weights anytime.
  const intent = why.filter(w => w.kind === 'intent').reduce((a, w) => a + w.score, 0);
  const platform = why.filter(w => w.kind === 'platform').reduce((a, w) => a + w.score, 0);
  const fit = why.filter(w => w.kind === 'fit').reduce((a, w) => a + w.score, 0);

  // Simple calibrated rule: heavy on intent, sanity-checked by platform/fit.
  const intentStrong = intent >= 0.75;
  const supportGood = (platform + fit) >= 0.6;

  return intentStrong && supportGood ? 'hot' : 'warm';
}

// --- router ---
export function mountReveal(app: express.Express) {
  // Health/ping for this module
  app.get('/api/v1/reveal/ping', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // Main reveal endpoint
  app.post('/api/v1/reveal', async (req, res) => {
    try {
      const userId = ((req as any).userId || req.header('x-galactly-user') || 'anon').toString();

      const body = (req.body ?? {}) as { leadId?: number | string; holdMs?: number };
      const leadId = Number(body.leadId);
      if (!leadId || Number.isNaN(leadId)) {
        return res.status(400).json({ ok: false, error: 'missing or invalid leadId' });
      }

      // Hold-to-reveal guard (protects Free plan)
      const minHold = Number(process.env.REVEAL_MIN_HOLD_MS ?? 1100);
      if (typeof body.holdMs === 'number' && body.holdMs < minHold) {
        return res.status(400).json({ ok: false, error: 'hold too short', minHoldMs: minHold });
      }

      // Rate limit per user/window
      const gate = await checkRate(userId);
      if (!gate.ok) {
        return res.status(429).json({
          ok: false,
          softBlock: true,
          nextInSec: gate.waitSec || 30,
          windowMin: gate.winMin,
          used: gate.count,
          limit: gate.lim,
        });
      }

      // Fetch the lead
      const r = await q<LeadRow>(
        `SELECT id, cat, kw, platform, source_url, title, snippet, created_at
           FROM lead_pool
          WHERE id = $1
          LIMIT 1`,
        [leadId]
      );
      const lead = r.rows[0];
      if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });

      // Build “why” (evidence list); also compute a safe host to show on card
      const host = hostnameOf(lead.source_url);
      const built = await buildWhy({
        id: lead.id,
        host,
        title: lead.title ?? undefined,
        snippet: (lead.snippet ?? '').toString(),
        platform: lead.platform ?? undefined,
        cat: lead.cat ?? undefined,
        kw: Array.isArray(lead.kw) ? lead.kw : [],
        url: lead.source_url ?? undefined,
        created_at: lead.created_at,
      });
      const why: WhyItem[] = built?.why ?? [];

      // Packaging math (server-side only; no external calls)
      const confidence = clamp(why.reduce((a, w) => a + (w.score || 0), 0) / Math.max(why.length || 1, 1), 0, 1);
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
        confidence,
      };

      const temperature = classifyTemperature(why); // 'hot' | 'warm'

      // Log event
      const meta = { holdMs: Number(body.holdMs || 0), temperature };
      await q(
        `INSERT INTO event_log(user_id, lead_id, event_type, meta)
         VALUES ($1, $2, 'reveal', $3::jsonb)`,
        [userId, leadId, JSON.stringify(meta)]
      );

      // Respond (hide raw URL in card, but you can include in modal if you want)
      return res.json({
        ok: true,
        temperature,
        lead: {
          id: lead.id,
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
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
