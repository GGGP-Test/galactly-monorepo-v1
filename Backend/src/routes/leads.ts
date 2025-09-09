// Backend/src/routes/leads.ts
import express from 'express';
import { q } from '../db';
import { clamp } from '../util';

/** helpers */
function hostFrom(url?: string | null): string | null {
  if (!url) return null;
  try { return new URL(String(url)).host || null; } catch { return null; }
}
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

type Why = { label: string; kind: 'meta'|'platform'|'signal'; score: number; detail: string };

function buildWhy(lead: LeadRow): { host: string | null; why: Why[] } {
  const host = hostFrom(lead.source_url);
  const tld = host?.split('.').pop()?.toLowerCase();
  const domainScore = ['com','co','ca','io','ai'].includes(String(tld)) ? 0.65 : 0.3;

  const platform = (lead.platform||'').toLowerCase();
  const platformScore = platform === 'shopify' ? 0.75 : platform === 'woocommerce' ? 0.6 : 0.4;

  const kws = (lead.kw||[]).map(k=>k.toLowerCase());
  const intent = ['packaging','carton','labels','rfp','rfq','mailers'];
  const hit = kws.filter(k => intent.includes(k));
  const intentScore = clamp(hit.length ? 0.7 + Math.min(0.3, hit.length*0.1) : 0.4, 0, 0.95);

  const why: Why[] = [
    { label:'Domain quality', kind:'meta',     score: domainScore,   detail: host ? `${host} (.${tld})` : 'n/a' },
    { label:'Platform fit',   kind:'platform', score: platformScore,  detail: platform || 'n/a' },
    { label:'Intent keywords',kind:'signal',   score: intentScore,    detail: (lead.kw||[]).join(', ') || 'n/a' }
  ];
  return { host: host||null, why };
}

function temperatureFrom(why: Why[]): 'hot'|'warm' {
  const avg = why.reduce((a,w)=>a+w.score,0) / (why.length||1);
  return avg >= 0.7 ? 'hot' : 'warm';
}

function adminOrApiOk(req: express.Request): boolean {
  const k = (req.headers['x-api-key'] || req.headers['x-admin-key'] || req.headers['authorization']) as string | undefined;
  const envK = process.env.API_KEY || process.env.ADMIN_TOKEN || process.env.ADMIN_KEY;
  if (!envK) return true;              // no key set => open (dev)
  if (!k) return false;
  // allow "Bearer <token>" or raw token
  const token = k.startsWith('Bearer ') ? k.slice(7) : k;
  return token === envK;
}

/** DB helpers */
async function getLead(id: number): Promise<LeadRow | null> {
  const r = await q<LeadRow>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool WHERE id=$1 LIMIT 1', [id]);
  return r.rows[0] || null;
}

async function listRecent(limit: number): Promise<LeadRow[]> {
  const r = await q<LeadRow>('SELECT id, cat, kw, platform, source_url, title, snippet, created_at FROM lead_pool ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows;
}

export function mountLeads(app: express.Express){
  /** fetch one */
  app.get('/api/v1/leads/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok:false, error:'bad id' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ ok:false, error:'not_found' });
    const { host, why } = buildWhy(lead);
    const temperature = temperatureFrom(why);
    res.json({ ok:true, temperature, lead: { id:String(lead.id), platform:lead.platform, cat:lead.cat, host, title:lead.title||host, created_at: lead.created_at }, why });
  });

  /** lists */
  app.get('/api/v1/leads/:temp(hot|warm)', async (req, res) => {
    const want = req.params.temp as 'hot'|'warm';
    const limit = Math.max(1, Math.min(200, Number(req.query.limit||10)));
    // fetch a little extra, filter in-process to honor our temperature band
    const rows = await listRecent(limit*5);
    const items = [];
    for (const r of rows){
      const { host, why } = buildWhy(r);
      const temp = temperatureFrom(why);
      if (temp === want){
        items.push({ id:String(r.id), platform:r.platform, cat:r.cat, host, title:r.title||host, created_at:r.created_at, temperature: temp, why });
        if (items.length >= limit) break;
      }
    }
    res.json({ ok:true, items });
  });

  /** stage */
  app.patch('/api/v1/leads/:id/stage', async (req, res) => {
    if (!adminOrApiOk(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
    const id = Number(req.params.id);
    const stage = String((req.body?.stage||'').toString().toLowerCase());
    if (!Number.isFinite(id) || !stage) return res.status(400).json({ ok:false, error:'bad request' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ ok:false, error:'not_found' });

    // just log; separate stage table is optional and not required for success
    await q('INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)',
      ['api', id, 'stage', { stage } as any]);
    res.json({ ok:true, id:String(id), stage });
  });

  /** notes */
  app.post('/api/v1/leads/:id/notes', async (req, res) => {
    if (!adminOrApiOk(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
    const id = Number(req.params.id);
    const note = String(req.body?.note||'').trim();
    if (!Number.isFinite(id) || !note) return res.status(400).json({ ok:false, error:'bad request' });
    const lead = await getLead(id);
    if (!lead) return res.status(404).json({ ok:false, error:'not_found' });
    await q('INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)',
      ['api', id, 'note', { note } as any]);
    res.json({ ok:true, id:String(id) });
  });

  /** CSV export */
  app.get('/api/v1/leads/export.csv', async (req, res) => {
    const want = String(req.query.temperature||'hot').toLowerCase() as 'hot'|'warm';
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit||200)));
    const rows = await listRecent(limit*5);

    const lines: string[] = [];
    lines.push('id,platform,cat,host,title,created_at,temperature');
    let cnt = 0;
    for (const r of rows){
      const { host, why } = buildWhy(r);
      const temp = temperatureFrom(why);
      if (temp !== want) continue;
      const title = (r.title||host||'').replaceAll('"','""');
      lines.push([r.id, r.platform||'', r.cat||'', host||'', `"${title}"`, r.created_at, temp].join(','));
      cnt++;
      if (cnt>=limit) break;
    }
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${want}.csv"`);
    res.send(lines.join('\n'));
  });

  /** single ingest */
  app.post('/api/v1/leads/ingest', async (req, res) => {
    if (!adminOrApiOk(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
    const body = req.body || {};
    const kw = Array.isArray(body.kw) ? body.kw.map(String) : [];
    const r = await q<LeadRow>(
      `INSERT INTO lead_pool(cat, kw, platform, source_url, title, snippet)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, cat, kw, platform, source_url, title, snippet, created_at`,
       [String(body.cat||''), kw, String(body.platform||''), String(body.source_url||''), String(body.title||''), String(body.snippet||'')]);
    const lead = r.rows[0];
    const { host, why } = buildWhy(lead);
    const temperature = temperatureFrom(why);
    res.json({ ok:true, temperature, lead: { id:String(lead.id), platform:lead.platform, cat:lead.cat, host, title:lead.title||host, created_at: lead.created_at }, why });
  });

  /** bulk ingest */
  app.post('/api/v1/leads/ingest/bulk', async (req, res) => {
    if (!adminOrApiOk(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
    const items = Array.isArray(req.body) ? req.body : [];
    const out: any[] = [];
    let inserted = 0;
    for (const b of items){
      const kw = Array.isArray(b.kw) ? b.kw.map(String) : [];
      const r = await q<LeadRow>(
        `INSERT INTO lead_pool(cat, kw, platform, source_url, title, snippet)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, cat, kw, platform, source_url, title, snippet, created_at`,
         [String(b.cat||''), kw, String(b.platform||''), String(b.source_url||''), String(b.title||''), String(b.snippet||'')]);
      const lead = r.rows[0];
      const { host, why } = buildWhy(lead);
      const temperature = temperatureFrom(why);
      out.push({ id:String(lead.id), platform:lead.platform, cat:lead.cat, host, title:lead.title||host, created_at: lead.created_at, temperature, why });
      inserted++;
    }
    res.json({ ok:true, inserted, items: out });
  });
}
