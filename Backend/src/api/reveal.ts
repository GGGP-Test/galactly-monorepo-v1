// Backend/src/api/reveal.ts
// Mounts POST /api/v1/reveal — hold‑to‑reveal gate + rich context for a lead
// Lightweight, no external calls. Safe for Northflank free tier.
//
// Wiring:
//   import { mountReveal } from './api/reveal';
//   mountReveal(app);
//
// ENV (optional):
//   REVEAL_MIN_HOLD_MS=1100         // minimum press‑and‑hold duration
//   REVEAL_LIMIT_10M=3              // max reveals per user per 10 minutes
//   REVEAL_WINDOW_MIN=10            // rate window in minutes
//   REVEAL_SHOW_PROOF_HINT=1        // include ad‑library hint URLs in payload

import express from 'express';
import { q } from '../db';

// Utilities
function domainFromUrl(u?: string): string {
  try { return new URL(String(u||'')).hostname.toLowerCase(); } catch { return ''; }
}
function minutesAgo(iso?: string | null): number {
  if (!iso) return 9e9; return Math.max(0, Math.round((Date.now() - new Date(iso).getTime())/60000));
}
function clamp(n: number, a: number, b: number){ return Math.max(a, Math.min(b, n)); }

// Simple PDP signal extract
function pdpSignals(text: string){
  const t = (text||'').toLowerCase();
  const sigs: string[] = [];
  if (/\b(case of|pack of|bundle)\b/.test(t)) sigs.push('Multi‑unit pack');
  if (/\bback in stock|in stock|restock\b/.test(t)) sigs.push('Restock/stock status');
  if (/\bnew flavor|limited|seasonal\b/.test(t)) sigs.push('New/seasonal SKU');
  if (/(oz|ml|lb|g)\b/.test(t)) sigs.push('Size/weight listed');
  return sigs;
}

// Heuristic "why" composer — no external calls
function buildWhy(lead: any){
  const host = domainFromUrl(lead.source_url);
  const why: Array<{label:string; detail:string; score:number; kind:string; proofHintUrl?:string}> = [];
  const freshMin = minutesAgo(lead.created_at);
  const showHints = (process.env.REVEAL_SHOW_PROOF_HINT === '1');

  // Freshness
  why.push({ label: 'Freshness', kind: 'freshness', score: clamp(1 - freshMin/240, 0, 1), detail: freshMin<120 ? `Seen ~${freshMin}m ago` : `Seen ${Math.round(freshMin/60)}h ago` });

  const kw: string[] = Array.isArray(lead.kw) ? lead.kw.map((s:string)=>String(s).toLowerCase()) : [];
  const platform = String(lead.platform||'').toLowerCase();

  // Ads / acquisition
  if (platform.includes('adlib') || kw.includes('ads') || kw.includes('spend')){
    const metaUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(host)}`;
    const gUrl   = `https://www.google.com/search?q=${encodeURIComponent('site:adstransparency.google.com ' + host)}`;
    const hint = showHints ? (platform.includes('meta') ? metaUrl : gUrl) : undefined;
    why.push({ label:'Active acquisition spend', kind:'demand', score:0.9, detail:'Recent ad activity visible on public ad libraries (proxy for moving units).', proofHintUrl: hint });
  }

  // Intake / procurement
  if (platform.includes('brandintake') || kw.includes('procurement') || kw.includes('supplier')){
    why.push({ label:'Open vendor intake', kind:'procurement', score:0.82, detail:'Supplier / procurement page is live and accepting submissions.' });
  }

  // PDP / retail signals
  if (platform.includes('pdp') || kw.includes('sku') || kw.includes('case')){
    const sigs = pdpSignals(`${lead.title||''} ${lead.snippet||''}`);
    const detail = sigs.length ? `PDP clues: ${sigs.join(', ')}.` : 'Product detail page suggests ongoing D2C or wholesale motion.';
    why.push({ label:'Retail SKU cadence', kind:'product', score:0.68, detail });
  }

  // Domain quality (simple)
  if (host){
    const tld = host.split('.').pop()||'';
    const dq = ['com','ca','co','io','ai'].includes(tld) ? 0.6 : 0.3;
    why.push({ label:'Domain quality', kind:'meta', score:dq, detail:`${host} (${tld.toUpperCase()})` });
  }

  return { host, why };
}

async function checkRate(userId: string){
  const lim = Number(process.env.REVEAL_LIMIT_10M || 3);
  const winMin = Number(process.env.REVEAL_WINDOW_MIN || 10);
  const r = await q<{ cnt: string; wait_sec: number }>(
    `WITH recent AS (
       SELECT created_at FROM event_log
       WHERE user_id=$1 AND event_type='reveal' AND created_at> now() - ($2::text||' minutes')::interval
     )
     SELECT COUNT(*)::text AS cnt,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM ((MIN(created_at) + ($2::text||' minutes')::interval) - now())))) AS wait_sec
       FROM recent`, [userId, String(winMin)]);
  const count = Number(r.rows[0]?.cnt || 0);
  const waitSec = Number(r.rows[0]?.wait_sec || 0);
  const ok = count < lim;
  return { ok, count, lim, waitSec, winMin };
}

export function mountReveal(app: express.Express){
  app.post('/api/v1/reveal', async (req, res) => {
    try{
      const userId = (req as any).userId || 'anon';
      const { leadId, holdMs } = req.body || {};
      if (!leadId) return res.status(400).json({ ok:false, error:'missing leadId' });

      // Hold‑to‑reveal guard
      const minHold = Number(process.env.REVEAL_MIN_HOLD_MS || 1100);
      if (typeof holdMs === 'number' && holdMs < minHold){
        return res.status(400).json({ ok:false, error:'hold too short', minHoldMs: minHold });
      }

      // Rate limit per user/window
      const gate = await checkRate(userId);
      if (!gate.ok){
        return res.status(429).json({ ok:false, softBlock:true, nextInSec: gate.waitSec || 30, windowMin: gate.winMin, used: gate.count, limit: gate.lim });
      }

      // Fetch lead
      const r = await q<any>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool WHERE id=$1 LIMIT 1', [Number(leadId)]);
      const lead = r.rows[0];
      if (!lead) return res.status(404).json({ ok:false, error:'lead not found' });

      // Compose why
      const { host, why } = buildWhy(lead);

      // Packaging math (partial; filled server‑side without external calls)
      const packagingMath = {
        spendPerMonth: null as number | null,
        estOrdersPerMonth: null as number | null,
        estUnitsPerMonth: null as number | null,
        packagingTypeHint: lead.cat === 'product' ? 'cartons/labels' : (lead.cat === 'procurement' ? 'general packaging' : 'mixed'),
        confidence: clamp(why.reduce((a,w)=>a+w.score,0)/ (why.length||1), 0, 1)
      };

      // Log event
      await q('INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)', [userId, Number(leadId), 'reveal', { holdMs: Number(holdMs||0) } as any]);

      // Shape response (hide raw URL on card; return here for modal if you want)
      res.json({ ok:true, lead: { id: lead.id, platform: lead.platform, cat: lead.cat, host, title: lead.title||host, created_at: lead.created_at }, why, packagingMath });
    }catch(e:any){
      res.status(500).json({ ok:false, error: String(e?.message||e) });
    }
  });
}
