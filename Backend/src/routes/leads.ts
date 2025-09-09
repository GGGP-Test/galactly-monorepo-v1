import type express from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function q<T = any>(text: string, params: any[] = []) {
  const c = await pool.connect();
  try { return (await c.query<T>(text, params as any)) as any; }
  finally { c.release(); }
}

type Why = { label: string; kind: 'meta' | 'platform' | 'signal'; score: number; detail?: string };
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function hostFromUrl(u?: string | null): string | null {
  try { return u ? new URL(u).hostname : null; } catch { return null; }
}

function buildWhy(lead: any) {
  const why: Why[] = [];
  const host = hostFromUrl(lead?.source_url);
  if (host) {
    const tld = host.split('.').pop() || '';
    const dq = ['com','ca','co','io','ai','net','org'].includes(tld) ? 0.65 : 0.35;
    why.push({ label: 'Domain quality', kind: 'meta', score: dq, detail: `${host} (.${tld})` });
  }
  const platform = String(lead?.platform || '').toLowerCase();
  if (platform) {
    const pf = ['shopify','woocommerce','bigcommerce'].includes(platform) ? 0.75 : 0.4;
    why.push({ label: 'Platform fit', kind: 'platform', score: pf, detail: platform });
  }
  const kw: string[] = Array.isArray(lead?.kw) ? lead.kw : [];
  const hasIntent = kw.some(k => ['packaging','carton','rfp','rfq','labels'].includes(String(k).toLowerCase()));
  if (kw.length) why.push({ label: 'Intent keywords', kind: 'signal', score: hasIntent ? 0.9 : 0.5, detail: kw.join(', ') });
  return { host: host || null, why };
}

function temperatureFromWhy(why: Why[]): 'hot'|'warm'|'cold' {
  const s = avg(why.map(w => clamp(w.score)));
  return s >= 0.75 ? 'hot' : s >= 0.5 ? 'warm' : 'cold';
}

export function mountLeads(app: express.Express) {
  // single lead (scored)
  app.get('/api/v1/leads/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
      const r = await q('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool WHERE id=$1 LIMIT 1', [id]);
      const lead = (r as any).rows?.[0];
      if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });

      const { host, why } = buildWhy(lead);
      const temperature = temperatureFromWhy(why);
      res.json({ ok: true, temperature, lead: { id: String(lead.id), platform: lead.platform, cat: lead.cat, host, title: lead.title || host, created_at: lead.created_at }, why });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // list hot/warm
  app.get('/api/v1/leads/hot', async (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
      const r = await q('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool ORDER BY created_at DESC LIMIT $1', [limit * 3]);
      const rows: any[] = (r as any).rows || [];
      const scored = rows.map(lead => {
        const { host, why } = buildWhy(lead);
        const temperature = temperatureFromWhy(why);
        return { temperature, lead: { id: String(lead.id), platform: lead.platform, cat: lead.cat, host, title: lead.title || host, created_at: lead.created_at }, why };
      });
      const filtered = scored.filter(s => s.temperature === 'hot' || s.temperature === 'warm').slice(0, limit);
      res.json({ ok: true, count: filtered.length, items: filtered });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
