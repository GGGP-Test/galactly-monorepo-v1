// Backend/src/index.ts
// @ts-nocheck
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cryptoRandomString from 'crypto-random-string';
import fs from 'fs';

import { db, upsertUser, initDb } from './db.js';
import { startSchedulers } from './scheduler.js';
import { initPush, saveSubscription, pushToUser } from './push.js';
import { clamp } from './util.js';
import { mountBilling } from './billing.js';

import { pollCSE } from './connectors/cse.js';
import { pollSamGov } from './connectors/samGov.js';
import { pollReddit } from './connectors/reddit.js';
import { pollRss } from './connectors/rss.js';
import { pollSocialFeeds } from './connectors/socialFirehose.js';

await initDb();
if (process.env.SCHEDULER_ENABLED === '1') startSchedulers();

process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
process.on('uncaughtException', err => console.error('[uncaughtException]', err));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// ------------ helpers -------------
function countList(envName: string, fileEnv: string) {
  const inline = (process.env[envName] || '').split(/[,\r\n]+/).map(s=>s.trim()).filter(Boolean);
  let fromFile: string[] = [];
  const p = process.env[fileEnv];
  if (p) { try { fromFile = (fs.readFileSync(p,'utf8')||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); } catch {} }
  return { inline: inline.length, file: fromFile.length, total: inline.length + fromFile.length };
}

function isAdmin(req: any) {
  const hdr = String(req.headers['authorization'] || '');
  const bearer = hdr.toLowerCase().startsWith('bearer ') ? hdr.slice(7) : '';
  const qp = String((req.query.token as string) || '');
  const supplied = bearer || qp || String(req.headers['x-admin-token'] || '');
  return ADMIN_TOKEN && supplied === ADMIN_TOKEN;
}

type SimpleLead = {
  id: number; cat: string; kw: string; platform: string;
  region: 'US'|'Canada'|'Other'; fit: number; compFit: number;
  heat: 'HOT'|'WARM'|'OK'; age: number; demo?: boolean;
};

const DEMO_POOL: Array<Omit<SimpleLead,'id'|'age'>> = [
  { cat:'Flexible', kw:'stand-up pouch', platform:'Practice', region:'US', fit:88, compFit:91, heat:'OK' },
  { cat:'Corrugated', kw:'mailer box', platform:'Practice', region:'US', fit:86, compFit:89, heat:'OK' },
  { cat:'Labels', kw:'GHS label', platform:'Practice', region:'US', fit:84, compFit:88, heat:'OK' },
  { cat:'Crating', kw:'ISPM-15 pallet', platform:'Practice', region:'US', fit:83, compFit:86, heat:'OK' },
  { cat:'Flexible', kw:'retort pouch', platform:'Practice', region:'US', fit:85, compFit:88, heat:'OK' },
  { cat:'Corrugated', kw:'RSC shipper', platform:'Practice', region:'US', fit:82, compFit:85, heat:'OK' },
  { cat:'Labels', kw:'thermal transfer', platform:'Practice', region:'US', fit:81, compFit:84, heat:'OK' },
  { cat:'Flexible', kw:'laminate film', platform:'Practice', region:'US', fit:87, compFit:90, heat:'OK' }
];

function makeDemoCards(n:number, catFilter:string): SimpleLead[] {
  const base = DEMO_POOL.filter(l => (catFilter === 'all' ? true : l.cat === catFilter));
  const pick = base.length ? base : DEMO_POOL;
  const out: SimpleLead[] = [];
  for (let i=0;i<n;i++){
    const x = pick[i % pick.length];
    out.push({ id:-(i+1), cat:x.cat, kw:x.kw, platform:x.platform, region:x.region, fit:x.fit, compFit:x.compFit, heat:x.heat, age:Math.floor(Math.random()*180)+30, demo:true });
  }
  return out;
}

const app = express();
app.use(express.json());
app.use(cors({ origin: (_o, cb) => cb(null, true), credentials: true }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

initPush();
mountBilling(app);

// health/debug
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.type('text/plain').send(`galactly-api ${process.env.RENDER_SERVICE_NAME || ''}`.trim()));
app.get('/api/v1/admin/ping', (req,res)=> {
  if (!isAdmin(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
  res.json({ ok:true, admin:true });
});

// --------- Debug / peek (async DB + counts from file/env) ----------
app.get('/api/v1/debug/peek', async (_req, res) => {
  const cAll = (await db.prepare(`SELECT COUNT(*) as n FROM lead_pool`).get()) as any || { n: 0 };
  const cAvail = (await db.prepare(`SELECT COUNT(*) as n FROM lead_pool WHERE state='available'`).get()) as any || { n: 0 };
  const sample = (await db.prepare(`SELECT id,cat,kw,platform,region,fit_user,generated_at FROM lead_pool ORDER BY generated_at DESC LIMIT 1`).get()) as any || {};
  const rss1 = countList('RSS_FEEDS','RSS_FEEDS_FILE');
  const rss2 = countList('RSSHUB_FEEDS','RSSHUB_FEEDS_FILE');
  const rss3 = countList('FEEDS_NATIVE','FEEDS_NATIVE_FILE');
  res.json({
    total: Number(cAll.n || 0),
    available: Number(cAvail.n || 0),
    sample,
    env: {
      SAM: !!process.env.SAM_API_KEY,
      REDDIT_ENABLED: process.env.REDDIT_ENABLED === 'true',
      RSS_FEEDS: rss1, RSSHUB_FEEDS: rss2, FEEDS_NATIVE: rss3,
      RSS_TOTAL: rss1.total + rss2.total + rss3.total
    }
  });
});

// --------- Admin ingest (token required, runs in background for reliability) ----------
async function runIngest(src: string) {
  if (src === 'sam'   || src === 'all') await pollSamGov();
  if (src === 'reddit'|| src === 'all') await pollReddit();
  if (src === 'rss'   || src === 'all') await pollRss();
  if (src === 'social'|| src === 'all') await pollSocialFeeds();
  if (src === 'cse'   || src === 'all') await pollCSE();
}
app.get('/api/v1/admin/poll-now', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const src = String(req.query.source || 'all').toLowerCase();
  // fire-and-forget to avoid proxy timeouts
  setImmediate(async () => { try { await runIngest(src); } catch (e) { console.error('[poll-now]', e); } });
  res.json({ ok: true, started: true, source: src });
});

// ---------- Presence ----------
const seen = new Map<string, number>();
setInterval(() => { const now = Date.now(); for (const [k, v] of seen) if (now - v > 2*60_000) seen.delete(k); }, 30_000);
function hourLocal() { const d = new Date(); return d.getUTCHours(); }
function humansOnlineValue() {
  const real = [...seen.values()].filter(ts => Date.now() - ts < 120_000).length;
  const h = hourLocal(); const floor = h >= 7 && h <= 22 ? 1 : 2; const pad = Math.min(5, Math.round(real * 0.1));
  return Math.max(real, floor) + pad;
}
function userId(req: any) { return (req.headers['x-galactly-user'] as string) || (req.query.userId as string) || 'anon-' + (req.ip || ''); }

// ---------- Routes ----------
app.post('/api/v1/gate', async (req, res) => {
  const { region = 'US', email = '', alerts = false } = req.body || {};
  const uid = userId(req);
  await upsertUser(uid, region, email);

  if (email && /@/.test(email) && (region === 'US' || region === 'Canada')) {
    await db.prepare(`UPDATE users SET fp = MIN(99, fp+3), verified_at=? WHERE id=?`).run(Date.now(), uid);
  }
  if (alerts) {
    await db.prepare(
      `INSERT INTO alerts(user_id,email_on,created_at,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET email_on=excluded.email_on, updated_at=excluded.updated_at`
    ).run(uid, 1, Date.now(), Date.now());
    await db.prepare(`UPDATE users SET multipliers_json=json_set(multipliers_json,'$.alerts',1.1) WHERE id=?`).run(uid);
  }
  return res.json({ ok: true });
});

app.get('/api/v1/leads', async (req, res) => {
  const uid = userId(req);
  const region = (req.query.region as string) || 'US';
  const cat = (req.query.cat as string) || 'all';
  const fitMin = parseInt((req.query.fitMin as string) || '60', 10);
  const q = ((req.query.q as string) || '').toLowerCase();

  seen.set(uid, Date.now());

  const where: string[] = ["state IN ('available','reserved')", 'expires_at > ?', 'region = ?'];
  const params: any[] = [Date.now(), region];
  if (cat !== 'all') { where.push('cat = ?'); params.push(cat); }
  if (fitMin)       { where.push('fit_user >= ?'); params.push(fitMin); }
  if (q) {
    where.push('(lower(kw) LIKE ? OR lower(cat) LIKE ? OR lower(platform) LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = await db.prepare(
    `SELECT id,cat,kw,platform,region,fit_user as fit,fit_competition as compFit,heat,
            ((strftime('%s','now')*1000 - generated_at)/1000) as age
     FROM lead_pool
     WHERE ${where.join(' AND ')}
     ORDER BY generated_at DESC
     LIMIT 64`
  ).all(...params) as SimpleLead[];

  const humansOnline = humansOnlineValue();
  const nextRefreshSec = 15;
  let cards: SimpleLead[] = rows || [];
  if (cards.length < 6) cards = [...cards, ...makeDemoCards(6 - cards.length, cat)];
  res.json({ leads: cards, humansOnline, nextRefreshSec });
});

app.post('/api/v1/claim', async (req, res) => {
  const uid = userId(req);
  const { leadId } = req.body || {};
  if (typeof leadId === 'number' && leadId < 0) {
    return res.json({ reservedForSec: 60, windowId: 'demo-' + Math.random().toString(36).slice(2), reveal: { whoFull: 'Practice lead', company: '—', contact: {}, demo: true } });
  }
  const cd = await db.prepare(`SELECT ends_at FROM cooldowns WHERE user_id=?`).get(uid) as any;
  if (cd && cd.ends_at > Date.now()) {
    const left = Math.ceil((cd.ends_at - Date.now()) / 1000);
    return res.status(429).json({ error: `Cooldown active. Wait ${left}s` });
  }
  const row = await db.prepare(`SELECT * FROM lead_pool WHERE id=? AND state='available' AND expires_at > ?`).get(leadId, Date.now()) as any;
  if (!row) return res.status(410).json({ error: 'Lead expired' });

  const reservedUntil = Date.now() + 60_000;
  const decisionDeadline = Date.now() + 5 * 60_000;
  const ok = await db.prepare(`UPDATE lead_pool SET state='reserved', reserved_by=?, reserved_until=? WHERE id=? AND state='available'`).run(uid, reservedUntil, leadId) as any;
  if (!ok || !ok.changes) return res.status(410).json({ error: 'Lead already claimed' });

  const windowId = cryptoRandomString({ length: 24 });
  await db.prepare(`INSERT INTO lead_windows(id,lead_id,user_id,reserved_until,decision_deadline) VALUES(?,?,?,?,?)`).run(windowId, leadId, uid, reservedUntil, decisionDeadline);
  await db.prepare(`INSERT INTO claims(lead_id,user_id,action,created_at) VALUES(?,?,?,?)`).run(leadId, uid, 'claim', Date.now());

  const abuse = (await db.prepare(`SELECT score FROM abuse WHERE user_id=?`).get(uid) as any)?.score || 0;
  const seconds = clamp(7 + Math.round(14 * abuse), 7, 300);
  await db.prepare(`INSERT INTO cooldowns(user_id,ends_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET ends_at=?`).run(uid, Date.now() + seconds * 1000, Date.now() + seconds * 1000);
  await db.prepare(`INSERT INTO abuse(user_id,score,last_inc_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET score=score+1,last_inc_at=?`).run(uid, 1, Date.now(), Date.now());

  const reveal = {
    whoFull: row.person_handle || row.company || 'Lead',
    company: row.company || '—',
    contact: row.contact_email ? { email: row.contact_email } : row.person_handle ? { handle: row.person_handle } : {}
  };

  pushToUser(uid, { type: 'lead_claimed', id: leadId, title: row.kw, platform: row.platform }).catch(() => {});
  res.json({ reservedForSec: 60, windowId, reveal });

  setTimeout(async () => {
    const w = await db.prepare(`SELECT 1 FROM lead_windows WHERE id=?`).get(windowId);
    const cur = await db.prepare(`SELECT state FROM lead_pool WHERE id=?`).get(leadId) as any;
    if (w && cur && cur.state === 'reserved') {
      await db.prepare(`UPDATE lead_pool SET state='available', reserved_by=NULL, reserved_until=NULL WHERE id=?`).run(leadId);
    }
  }, 60_500);

  setTimeout(async () => {
    const cur = await db.prepare(`SELECT state,reserved_by FROM lead_pool WHERE id=?`).get(leadId) as any;
    if (cur && cur.state !== 'owned') {
      await db.prepare(`UPDATE lead_pool SET state='returned', reserved_by=NULL, reserved_until=NULL WHERE id=?`).run(leadId);
      await db.prepare(`DELETE FROM lead_windows WHERE id=?`).run(windowId);
      await db.prepare(`UPDATE users SET fp = MAX(0, fp-1) WHERE id=?`).run(uid);
    }
  }, 5 * 60_000 + 2_000);
});

app.post('/api/v1/own', async (req, res) => {
  const uid = userId(req);
  const { windowId } = req.body || {};
  const w = await db.prepare(`SELECT lead_id FROM lead_windows WHERE id=? AND user_id=?`).get(windowId, uid) as any;
  if (!w) return res.status(404).json({ error: 'Window not found' });

  const ok = await db.prepare(`UPDATE lead_pool SET state='owned' WHERE id=? AND state IN ('reserved','available')`).run(w.lead_id) as any;
  if (!ok || !ok.changes) return res.status(410).json({ error: 'Lead already owned/expired' });

  await db.prepare(`DELETE FROM lead_windows WHERE id=?`).run(windowId);
  await db.prepare(`INSERT INTO claims(lead_id,user_id,action,created_at) VALUES(?,?,?,?)`).run(w.lead_id, uid, 'own', Date.now());
  const alerts = await db.prepare(`SELECT email_on FROM alerts WHERE user_id=?`).get(uid) as any;
  const delta = alerts && alerts.email_on ? 4 : 2;
  await db.prepare(`UPDATE users SET fp = MIN(99, fp+?) WHERE id=?`).run(delta, uid);
  await db.prepare(`UPDATE abuse SET score = MAX(0, score-1) WHERE user_id=?`).run(uid);

  res.json({ ok: true });
});

app.post('/api/v1/arrange-more', async (req, res) => {
  const uid = userId(req);
  const { leadId } = req.body || {};
  const lead = await db.prepare(`SELECT cat,kw,platform FROM lead_pool WHERE id=?`).get(leadId) as any;
  if (lead) {
    const now = Date.now();
    const prefs = (await db.prepare(`SELECT cat_weights_json,kw_weights_json,plat_weights_json FROM user_prefs WHERE user_id=?`).get(uid) as any) || { cat_weights_json: '{}', kw_weights_json: '{}', plat_weights_json: '{}' };
    const cat = JSON.parse(prefs.cat_weights_json || '{}');
    const kw = JSON.parse(prefs.kw_weights_json || '{}');
    const plat = JSON.parse(prefs.plat_weights_json || '{}');
    cat[lead.cat] = (cat[lead.cat] || 0) + 0.4;
    kw[lead.kw] = (kw[lead.kw] || 0) + 0.6;
    plat[lead.platform] = (plat[lead.platform] || 0) + 0.3;
    await db.prepare(`UPDATE user_prefs SET cat_weights_json=?, kw_weights_json=?, plat_weights_json=?, updated_at=? WHERE user_id=?`).run(JSON.stringify(cat), JSON.stringify(kw), JSON.stringify(plat), now, uid);
    await db.prepare(`UPDATE users SET fp = MIN(99, fp+1) WHERE id=?`).run(uid);
    await db.prepare(`INSERT INTO claims(lead_id,user_id,action,created_at) VALUES(?,?,?,?)`).run(leadId, uid, 'arrange_more', now);
  }
  res.json({ ok: true });
});

app.post('/api/v1/human-check', async (req, res) => {
  const uid = userId(req);
  await db.prepare(`UPDATE users SET fp = MIN(99, fp+2) WHERE id=?`).run(uid);
  await db.prepare(`DELETE FROM cooldowns WHERE user_id=?`).run(uid);
  res.json({ ok: true, fpDelta: 2 });
});

app.post('/api/v1/alerts', async (req, res) => {
  const uid = userId(req);
  const { emailOn } = req.body || {};
  await db.prepare(`INSERT INTO alerts(user_id,email_on,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_on=excluded.email_on, updated_at=excluded.updated_at`).run(uid, emailOn ? 1 : 0, Date.now(), Date.now());
  await db.prepare(`UPDATE users SET multipliers_json=json_set(multipliers_json,'$.alerts', ?) WHERE id=?`).run(emailOn ? 1.1 : 1.0, uid);
  res.json({ ok: true });
});

app.post('/api/v1/push/subscribe', async (req, res) => {
  const uid = userId(req);
  const sub = req.body;
  saveSubscription(uid, sub);
  res.json({ ok: true });
});

app.post('/api/v1/debug/seed', async (_req, res) => {
  const now = Date.now();
  const demo = [
    ['Flexible','stand-up pouch','Demo','US',88,'https://example.com/1','Looking for 50k stand-up pouches'],
    ['Corrugated','mailer box','Demo','US',86,'https://example.com/2','Need custom mailer boxes with inserts'],
    ['Labels','GHS label','Demo','US',84,'https://example.com/3','GHS chemical labels required'],
  ];
  for (const [cat,kw,platform,region,fit,src,evi] of demo) {
    await db.prepare(`
      INSERT INTO lead_pool
      (cat,kw,platform,region,fit_user,fit_competition,heat,source_url,evidence_snippet,generated_at,expires_at,state)
      VALUES(?,?,?,?,?,?,?, ?,?,?,?,'available')`).run(cat, kw, platform, region, Number(fit), Number(fit)+3, 'OK', src, evi, now, now + 72*3600*1000);
  }
  res.json({ ok:true, added: demo.length });
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log('API up on', port));
