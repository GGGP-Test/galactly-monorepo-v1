// Backend/src/routes/leads.ts
import express from 'express';
import { z } from 'zod';
import { q } from '../db';

const API_KEY_ENV =
  (process.env.API_KEY?.trim()) ||
  (process.env.ADMIN_KEY?.trim()) ||
  (process.env.ADMIN_TOKEN?.trim()) || '';

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction){
  if (!API_KEY_ENV) return res.status(503).json({ ok:false, error:'ingest disabled: no API_KEY/ADMIN_TOKEN set' });
  const hdr = (req.header('x-api-key') || req.header('x-admin-key') || '') ||
              ((req.header('authorization')||'').toLowerCase().startsWith('bearer ')
                ? (req.header('authorization')||'').slice(7).trim() : '');
  if ((hdr||'').trim() !== API_KEY_ENV) return res.status(401).json({ ok:false, error:'unauthorized' });
  next();
}

function hostFromUrl(u?: string|null){
  if (!u) return null;
  try{
    const h = new URL(u).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  }catch{ return null; }
}

type Row = {
  id: string|number; cat: string|null; kw: string[]|null; platform: string|null;
  source_url: string|null; title: string|null; snippet?: string|null; created_at: string|Date|null;
};
type Why = { label: string; kind:'meta'|'platform'|'signal'; score:number; detail:string };

function buildWhy(r: Row){ 
  const why:Why[] = [];
  const host = hostFromUrl(r.source_url);

  if (host){
    const tld = host.split('.').pop()||'';
    const dq = ['com','ca','co','io','ai','net','org'].includes(tld) ? 0.65 : 0.3;
    why.push({ label:'Domain quality', kind:'meta', score:dq, detail:`${host} (.${tld})` });
  }
  const p = (r.platform||'').toLowerCase();
  if (p){
    const pf = p==='shopify' ? 0.75 : p==='woocommerce' ? 0.6 : 0.5;
    why.push({ label:'Platform fit', kind:'platform', score:pf, detail:p });
  }
  const kws = (r.kw||[]).map(s=>s.toLowerCase().trim()).filter(Boolean);
  const intentTerms = ['rfp','rfq','packaging','carton','mailers','labels','box','boxes'];
  const hit = kws.filter(k=>intentTerms.includes(k));
  if (hit.length){
    const hasRfx = hit.some(k=>k==='rfp'||k==='rfq');
    const sc = hasRfx ? 0.9 : 0.8;
    why.push({ label:'Intent keywords', kind:'signal', score:sc, detail: hit.join(', ') });
  }
  const avg = why.length ? (why.reduce((a,b)=>a+b.score,0)/why.length) : 0;
  const temperature: 'hot' | 'warm' = avg >= 0.7 ? 'hot' : 'warm';
  return { why, temperature, host };
}

function leadSummary(r: Row, temperature:'hot'|'warm', host:string|null){
  return {
    id: String(r.id), platform: r.platform, cat: r.cat, host: host || hostFromUrl(r.source_url),
    title: r.title || (host||'unknown'),
    created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    temperature,
  };
}

const stageEnum = z.enum(['new','qualified','outreach','engaged','won','lost','spam']);

// ----------------- router -----------------
const router = express.Router();

// detail
router.get('/api/v1/leads/:id', async (req,res)=>{
  const id = String(req.params.id||'').trim();
  if (!/^\d+$/.test(id)) return res.status(400).json({ ok:false, error:'bad id' });
  try{
    const r = await q<Row>('SELECT id,cat,kw,platform,source_url,title,snippet,created_at FROM lead_pool WHERE id=$1 LIMIT 1',[Number(id)]);
    const row = r.rows[0]; if(!row) return res.status(404).json({ ok:false, error:'not_found' });
    const { why, temperature, host } = buildWhy(row);
    res.json({ ok:true, temperature, lead: leadSummary(row, temperature, host), why });
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// hot & warm lists
async function listByTemp(temp:'hot'|'warm', limit:number){
  const r = await q<Row>('SELECT id,cat,kw,platform,source_url,title,snippet,created_at FROM lead_pool ORDER BY created_at DESC NULLS LAST LIMIT $1',[limit*3]);
  return r.rows.map(row=>{
    const b = buildWhy(row);
    return { row, ...b };
  }).filter(x=>x.temperature===temp).slice(0,limit).map(x=>({
    ...leadSummary(x.row, x.temperature, x.host), why: x.why
  }));
}
router.get('/api/v1/leads/hot',  async (req,res)=>{ const limit = Math.min(Math.max(Number(req.query.limit||10),1),100); try{ res.json({ ok:true, items: await listByTemp('hot',limit) }); }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }});
router.get('/api/v1/leads/warm', async (req,res)=>{ const limit = Math.min(Math.max(Number(req.query.limit||10),1),100); try{ res.json({ ok:true, items: await listByTemp('warm',limit) }); }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }});

// ingest (single)
router.post('/api/v1/leads/ingest', requireApiKey, async (req,res)=>{
  const schema = z.object({
    cat: z.string().default('product'),
    kw: z.array(z.string()).default([]),
    platform: z.string().optional().default(''),
    source_url: z.string().url(),
    title: z.string().optional().default(''),
    snippet: z.string().optional().default(''),
  });
  const p = schema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ ok:false, error:'bad_payload', issues:p.error.issues });
  try{
    const ins = await q<Row>(
      `INSERT INTO lead_pool(cat,kw,platform,source_url,title,snippet)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id,cat,kw,platform,source_url,title,snippet,created_at`,
      [p.data.cat, p.data.kw, p.data.platform, p.data.source_url, p.data.title, p.data.snippet]
    );
    const row = ins.rows[0];
    const { why, temperature, host } = buildWhy(row);
    res.json({ ok:true, temperature, lead: leadSummary(row, temperature, host), why });
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// ingest (bulk)
router.post('/api/v1/leads/ingest/bulk', requireApiKey, async (req,res)=>{
  if (!Array.isArray(req.body)) return res.status(400).json({ ok:false, error:'expected array' });
  const schema = z.object({
    cat: z.string().default('product'),
    kw: z.array(z.string()).default([]),
    platform: z.string().optional().default(''),
    source_url: z.string().url(),
    title: z.string().optional().default(''),
    snippet: z.string().optional().default(''),
  });
  const items = [];
  for (const it of req.body){ const p = schema.safeParse(it); if (p.success) items.push(p.data); }
  if (!items.length) return res.json({ ok:true, inserted:0, items:[] });
  try{
    const out:any[] = [];
    for (const v of items){
      const ins = await q<Row>(
        `INSERT INTO lead_pool(cat,kw,platform,source_url,title,snippet)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id,cat,kw,platform,source_url,title,snippet,created_at`,
        [v.cat, v.kw, v.platform, v.source_url, v.title, v.snippet]
      );
      const row = ins.rows[0]; const b = buildWhy(row);
      out.push({ ...leadSummary(row, b.temperature, b.host), temperature: b.temperature, why: b.why });
    }
    res.json({ ok:true, inserted: out.length, items: out });
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// stage & notes
router.patch('/api/v1/leads/:id/stage', requireApiKey, async (req,res)=>{
  const id = String(req.params.id||'').trim(); if(!/^\d+$/.test(id)) return res.status(400).json({ ok:false, error:'bad id' });
  const body = z.object({ stage: stageEnum }).safeParse(req.body);
  if(!body.success) return res.status(400).json({ ok:false, error:'bad_payload', issues: body.error.issues });
  try{
    await q('INSERT INTO lead_meta(lead_id,stage) VALUES ($1,$2) ON CONFLICT (lead_id) DO UPDATE SET stage=EXCLUDED.stage',[Number(id), body.data.stage]);
    res.json({ ok:true, id, stage: body.data.stage });
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

router.post('/api/v1/leads/:id/notes', requireApiKey, async (req,res)=>{
  const id = String(req.params.id||'').trim(); if(!/^\d+$/.test(id)) return res.status(400).json({ ok:false, error:'bad id' });
  const body = z.object({ note: z.string().min(1) }).safeParse(req.body);
  if(!body.success) return res.status(400).json({ ok:false, error:'bad_payload', issues: body.error.issues });
  try{
    const ts = new Date().toISOString();
    await q(
      `INSERT INTO lead_meta(lead_id,notes) VALUES ($1,$2)
       ON CONFLICT (lead_id) DO UPDATE SET notes =
         CASE WHEN lead_meta.notes IS NULL OR lead_meta.notes='' THEN EXCLUDED.notes
              ELSE lead_meta.notes || E'\n' || EXCLUDED.notes END`,
      [Number(id), `[${ts}] ${body.data.note}`]
    );
    const r = await q<{stage:string|null;notes:string|null}>('SELECT stage,notes FROM lead_meta WHERE lead_id=$1',[Number(id)]);
    res.json({ ok:true, id, stage: r.rows[0]?.stage||'new', notes: r.rows[0]?.notes||'' });
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// export CSV
router.get('/api/v1/leads/export.csv', async (req,res)=>{
  const temp = String(req.query.temperature||'').toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit||100),1),1000);
  try{
    const r = await q<Row>('SELECT id,cat,kw,platform,source_url,title,snippet,created_at FROM lead_pool ORDER BY created_at DESC NULLS LAST LIMIT $1',[limit*3]);
    const rows = r.rows.map(row=>({ row, ...buildWhy(row) }));
    const filtered = (temp==='hot'||temp==='warm') ? rows.filter(x=>x.temperature===temp) : rows;
    const list = filtered.slice(0,limit);
    const esc = (s:any)=>{ const t=(s==null)?'':String(s); return /[",\n]/.test(t)?`"${t.replace(/"/g,'""')}"`:t; };
    const header = ['id','temperature','platform','cat','host','title','created_at','source_url','why_labels','why_scores'].join(',');
    const lines = [header];
    for (const it of list){
      const lead = leadSummary(it.row, it.temperature, it.host);
      const labels = it.why.map(w=>w.label).join('|');
      const scores = it.why.map(w=>w.score.toFixed(2)).join('|');
      lines.push([esc(lead.id),esc(lead.temperature),esc(lead.platform),esc(lead.cat),esc(lead.host),esc(lead.title),esc(lead.created_at),esc(it.row.source_url||''),esc(labels),esc(scores)].join(','));
    }
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="leads_${temp||'all'}.csv"`);
    res.status(200).send(lines.join('\n'));
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// NEW: search
router.get('/api/v1/leads/search', async (req,res)=>{
  const qstr = String(req.query.q||'').trim();
  const temp = String(req.query.temperature||'').toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit||20),1),100);

  try{
    // naive search: title/source_url ilike, kw @> query tokens when tokens provided
    const tokens = qstr.split(/\s+/).map(s=>s.toLowerCase()).filter(Boolean);
    const sql =
      `SELECT id, cat, kw, platform, source_url, title, snippet, created_at
         FROM lead_pool
        WHERE ($1 = '' OR title ILIKE '%'||$1||'%' OR source_url ILIKE '%'||$1||'%' )
        ORDER BY created_at DESC NULLS LAST
        LIMIT $2`;
    const r = await q<Row>(sql, [qstr, limit*3]);

    let items = r.rows.map(row => ({ row, ...buildWhy(row) }));
    if (temp==='hot' || temp==='warm') items = items.filter(x=>x.temperature===temp);

    const out = items.slice(0,limit).map(x=>({
      ...leadSummary(x.row, x.temperature, x.host), why: x.why
    }));
    res.json({ ok:true, items: out });
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// NEW: audit timeline for a lead
router.get('/api/v1/leads/:id/audit', async (req,res)=>{
  const id = String(req.params.id||'').trim(); if(!/^\d+$/.test(id)) return res.status(400).json({ ok:false, error:'bad id' });
  try{
    // safe: if the table doesn't exist, this will error—tell the caller
    const r = await q<{created_at:string; event_type:string; meta:any}>(
      `SELECT created_at, event_type, meta
         FROM event_log
        WHERE lead_id=$1
        ORDER BY created_at DESC
        LIMIT 200`, [Number(id)]);
    res.json({ ok:true, items: r.rows });
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

export default function registerLeadsRoutes(app: express.Express){
  app.use(router);
}
