import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cryptoRandomString from 'crypto-random-string';
import { db, upsertUser } from './db.js';
import { startSchedulers } from './scheduler.js';
import { initPush, saveSubscription, pushToUser } from './push.js';
import { clamp } from './util.js';
import { registerBilling } from './billing.js';


// ---------- Demo backfill types & pool ----------
type SimpleLead = {
  id: number;
  cat: string;
  kw: string;
  platform: string;
  region: 'US' | 'Canada' | 'Other';
  fit: number;
  compFit: number;
  heat: 'HOT' | 'WARM' | 'OK';
  age: number;
  demo?: boolean;
};

const DEMO_POOL: Array<Omit<SimpleLead, 'id' | 'age'>> = [
  { cat: 'Flexible',   kw: 'stand-up pouch',   platform: 'Practice', region: 'US', fit: 88, compFit: 91, heat: 'OK' },
  { cat: 'Corrugated', kw: 'mailer box',       platform: 'Practice', region: 'US', fit: 86, compFit: 89, heat: 'OK' },
  { cat: 'Labels',     kw: 'GHS label',        platform: 'Practice', region: 'US', fit: 84, compFit: 88, heat: 'OK' },
  { cat: 'Crating',    kw: 'ISPM-15 pallet',   platform: 'Practice', region: 'US', fit: 83, compFit: 86, heat: 'OK' },
  { cat: 'Flexible',   kw: 'retort pouch',     platform: 'Practice', region: 'US', fit: 85, compFit: 88, heat: 'OK' },
  { cat: 'Corrugated', kw: 'RSC shipper',      platform: 'Practice', region: 'US', fit: 82, compFit: 85, heat: 'OK' },
  { cat: 'Labels',     kw: 'thermal transfer', platform: 'Practice', region: 'US', fit: 81, compFit: 84, heat: 'OK' },
  { cat: 'Flexible',   kw: 'laminate film',    platform: 'Practice', region: 'US', fit: 87, compFit: 90, heat: 'OK' }
];

function makeDemoCards(n: number, catFilter: string): SimpleLead[] {
  const base = DEMO_POOL.filter(l => (catFilter === 'all' ? true : l.cat === catFilter));
  const pick = base.length ? base : DEMO_POOL;
  const out: SimpleLead[] = [];
  for (let i = 0; i < n; i++) {
    const x = pick[i % pick.length];
    out.push({
      id: -(i + 1), // negative ids = demo
      cat: x.cat,
      kw: x.kw,
      platform: x.platform,
      region: x.region,
      fit: x.fit,
      compFit: x.compFit,
      heat: x.heat,
      age: Math.floor(Math.random() * 180) + 30, // 30–210s
      demo: true
    });
  }
  return out;
}

// ---------- Express app ----------
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: (_origin: string | undefined, cb: (err: any, allow?: boolean) => void) => cb(null, true),
    credentials: true
  })
);
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

initPush();
startSchedulers();

// ---------- Connectors + debug ----------
import { pollSamGov } from './connectors/samGov.js';
import { pollReddit } from './connectors/reddit.js';
import { pollRss } from './connectors/rss.js';

// VAPID public key for frontend
app.get('/vapid.txt', (_req, res) => res.type('text/plain').send(process.env.VAPID_PUBLIC_KEY || ''));

// Quick health/debug
app.get('/api/v1/debug/peek', (_req, res) => {
  const cAll = db.prepare(`SELECT COUNT(*) as n FROM lead_pool`).get() as any;
  const cAvail = db.prepare(`SELECT COUNT(*) as n FROM lead_pool WHERE state='available'`).get() as any;
  const sample = db
    .prepare(
      `SELECT id,cat,kw,platform,region,fit_user,generated_at FROM lead_pool ORDER BY generated_at DESC LIMIT 1`
    )
    .get() as any;
  res.json({
    total: cAll.n,
    available: cAvail.n,
    sample,
    env: {
      SAM: !!process.env.SAM_API_KEY,
      REDDIT_ENABLED: process.env.REDDIT_ENABLED === 'true',
      RSS_FEEDS: (process.env.RSS_FEEDS || '').split(',').filter(Boolean).length
    }
  });
});

// Force-run connectors
app.get('/api/v1/admin/poll-now', async (req, res) => {
  const src = String(req.query.source || 'all').toLowerCase();
  try {
    if (src === 'sam' || src === 'all') await pollSamGov();
    if (src === 'reddit' || src === 'all') await pollReddit();
    if (src === 'rss' || src === 'all') await pollRss();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Seed demo rows into DB (optional)
app.post('/api/v1/debug/seed', (_req, res) => {
  const now = Date.now();
  const demo = [
    ['Flexible', 'stand-up pouch', 'Demo', 'US', 88, 'https://example.com/1', 'Looking for 50k stand-up pouches'],
    ['Corrugated', 'mailer box', 'Demo', 'US', 86, 'https://example.com/2', 'Need custom mailer boxes with inserts'],
    ['Labels', 'GHS label', 'Demo', 'US', 84, 'https://example.com/3', 'GHS chemical labels required'],
    ['Crating', 'ISPM-15 pallet', 'Demo', 'US', 82, 'https://example.com/4', 'Export pallets ISPM-15'],
    ['Flexible', 'retort pouch', 'Demo', 'US', 85, 'https://example.com/5', 'Retort pouches for ready meals'],
    ['Corrugated', 'RSC shipper', 'Demo', 'US', 83, 'https://example.com/6', 'RSC shippers 12x9x4'],
    ['Labels', 'thermal transfer', 'Demo', 'US', 81, 'https://example.com/7', 'TT labels 4x6'],
    ['Flexible', 'laminate film', 'Demo', 'US', 87, 'https://example.com/8', 'PET/PE laminate rollstock']
  ];
  const stmt = db.prepare(`
    INSERT INTO lead_pool
      (cat,kw,platform,region,fit_user,fit_competition,heat,source_url,evidence_snippet,generated_at,expires_at,state)
    VALUES (?,?,?,?,?,?,?, ?,?,?,?,'available')
  `);
  for (const [cat, kw, platform, region, fit, src, evi] of demo) {
    stmt.run(cat, kw, platform, region, Number(fit), Number(fit) + 3, 'OK', src, evi, now, now + 72 * 3600 * 1000);
  }
  res.json({ ok: true, added: demo.length });
});

// ---------- Presence (humans online) ----------
const seen = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of seen) if (now - v > 2 * 60_000) seen.delete(k);
}, 30_000);

function hourLocal() {
  const d = new Date();
  return d.getUTCHours(); // simple UTC-based hour; good enough for free tier
}

function humansOnlineValue() {
  const real = [...seen.values()].filter(ts => Date.now() - ts < 120_000).length;
  const h = hourLocal();
  const floor = h >= 7 && h <= 22 ? 1 : 2; // avoid 0 at night
  const pad = Math.min(5, Math.round(real * 0.1));
  return Math.max(real, floor) + pad;
}

function userId(req: any) {
  return (req.headers['x-galactly-user'] as string) || (req.query.userId as string) || 'anon-' + (req.ip || '');
}

// ---------- Routes ----------
app.post('/api/v1/gate', (req, res) => {
  const { industries = [], region = 'US', email = '', alerts = false } = req.body || {};
  const uid = userId(req);
  upsertUser(uid, region, email);

  if (email && /@/.test(email) && (region === 'US' || region === 'Canada')) {
    db.prepare(`UPDATE users SET fp = MIN(99, fp+3), verified_at=? WHERE id=?`).run(Date.now(), uid);
  }
  if (alerts) {
    db.prepare(
      `INSERT INTO alerts(user_id,email_on,created_at,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET email_on=excluded.email_on, updated_at=excluded.updated_at`
    ).run(uid, 1, Date.now(), Date.now());
    db.prepare(`UPDATE users SET multipliers_json=json_set(multipliers_json,'$.alerts',1.1) WHERE id=?`).run(uid);
  }
  return res.json({ ok: true });
});

app.get('/api/v1/leads', (req, res) => {
  const uid = userId(req);
  const region = (req.query.region as string) || 'US';
  const cat = (req.query.cat as string) || 'all';
  const fitMin = parseInt((req.query.fitMin as string) || '60', 10);
  const q = ((req.query.q as string) || '').toLowerCase();

  seen.set(uid, Date.now());

  const where: string[] = ["state IN ('available','reserved')", 'expires_at > ?', 'region = ?'];
  const params: any[] = [Date.now(), region];
  if (cat !== 'all') {
    where.push('cat = ?');
    params.push(cat);
  }
  if (fitMin) {
    where.push('fit_user >= ?');
    params.push(fitMin);
  }
  if (q) {
    where.push('(lower(kw) LIKE ? OR lower(cat) LIKE ? OR lower(platform) LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = db
    .prepare(
      `SELECT id,cat,kw,platform,region,fit_user as fit,fit_competition as compFit,heat,
              ((strftime('%s','now')*1000 - generated_at)/1000) as age
       FROM lead_pool
       WHERE ${where.join(' AND ')}
       ORDER BY generated_at DESC
       LIMIT 64`
    )
    .all(...params) as SimpleLead[];

  const humansOnline = humansOnlineValue();
  const nextRefreshSec = 15;

  // Backfill with demo/practice cards if quiet
  let cards: SimpleLead[] = rows;
  if (cards.length < 6) {
    const need = 6 - cards.length;
    const demos = makeDemoCards(need, cat);
    cards = [...cards, ...demos];
  }

  return res.json({ leads: cards, humansOnline, nextRefreshSec });
});

app.post('/api/v1/claim', (req, res) => {
  const uid = userId(req);
  const { leadId } = req.body || {};

  // ---- Demo claim short-circuit (negative IDs) ----
  if (typeof leadId === 'number' && leadId < 0) {
    return res.json({
      reservedForSec: 60,
      windowId: 'demo-' + Math.random().toString(36).slice(2),
      reveal: { whoFull: 'Practice lead', company: '—', contact: {}, demo: true }
    });
  }

  // ---- Cooldown check ----
  const cd = db.prepare(`SELECT ends_at FROM cooldowns WHERE user_id=?`).get(uid) as any;
  if (cd && cd.ends_at > Date.now()) {
    const left = Math.ceil((cd.ends_at - Date.now()) / 1000);
    return res.status(429).json({ error: `Cooldown active. Wait ${left}s` });
  }

  // ---- Reserve lead ----
  const row = db
    .prepare(`SELECT * FROM lead_pool WHERE id=? AND state='available' AND expires_at > ?`)
    .get(leadId, Date.now()) as any;
  if (!row) return res.status(410).json({ error: 'Lead expired' });

  const reservedUntil = Date.now() + 60_000;
  const decisionDeadline = Date.now() + 5 * 60_000;
  const ok = db
    .prepare(
      `UPDATE lead_pool SET state='reserved', reserved_by=?, reserved_until=? WHERE id=? AND state='available'`
    )
    .run(uid, reservedUntil, leadId);
  if (!ok.changes) return res.status(410).json({ error: 'Lead already claimed' });

  const windowId = cryptoRandomString({ length: 24 });
  db.prepare(
    `INSERT INTO lead_windows(id,lead_id,user_id,reserved_until,decision_deadline) VALUES(?,?,?,?,?)`
  ).run(windowId, leadId, uid, reservedUntil, decisionDeadline);
  db.prepare(`INSERT INTO claims(lead_id,user_id,action,created_at) VALUES(?,?,?,?)`).run(
    leadId,
    uid,
    'claim',
    Date.now()
  );

  const abuse = (db.prepare(`SELECT score FROM abuse WHERE user_id=?`).get(uid) as any)?.score || 0;
  const seconds = clamp(7 + Math.round(14 * abuse), 7, 300);
  db.prepare(
    `INSERT INTO cooldowns(user_id,ends_at) VALUES(?,?)
     ON CONFLICT(user_id) DO UPDATE SET ends_at=?`
  ).run(uid, Date.now() + seconds * 1000, Date.now() + seconds * 1000);
  db.prepare(
    `INSERT INTO abuse(user_id,score,last_inc_at) VALUES(?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET score=score+1,last_inc_at=?`
  ).run(uid, 1, Date.now(), Date.now());

  const reveal = {
    whoFull: row.person_handle || row.company || 'Lead',
    company: row.company || '—',
    contact: row.contact_email
      ? { email: row.contact_email }
      : row.person_handle
      ? { handle: row.person_handle }
      : {}
  };

  // Push alert (best effort)
  pushToUser(uid, { type: 'lead_claimed', id: leadId, title: row.kw, platform: row.platform }).catch(() => {});
  res.json({ reservedForSec: 60, windowId, reveal });

  // Release to pool after 60s if not owned
  setTimeout(() => {
    const w = db.prepare(`SELECT 1 FROM lead_windows WHERE id=?`).get(windowId);
    const cur = db.prepare(`SELECT state FROM lead_pool WHERE id=?`).get(leadId) as any;
    if (w && cur && cur.state === 'reserved') {
      db.prepare(`UPDATE lead_pool SET state='available', reserved_by=NULL, reserved_until=NULL WHERE id=?`).run(
        leadId
      );
    }
  }, 60_500);

  // Auto-return after 5 min
  setTimeout(() => {
    const cur = db.prepare(`SELECT state,reserved_by FROM lead_pool WHERE id=?`).get(leadId) as any;
    if (cur && cur.state !== 'owned') {
      db.prepare(`UPDATE lead_pool SET state='returned', reserved_by=NULL, reserved_until=NULL WHERE id=?`).run(
        leadId
      );
      db.prepare(`DELETE FROM lead_windows WHERE id=?`).run(windowId);
      db.prepare(`UPDATE users SET fp = MAX(0, fp-1) WHERE id=?`).run(uid);
    }
  }, 5 * 60_000 + 2_000);
});

app.post('/api/v1/own', (req, res) => {
  const uid = userId(req);
  const { windowId } = req.body || {};
  const w = db.prepare(`SELECT lead_id FROM lead_windows WHERE id=? AND user_id=?`).get(windowId, uid) as any;
  if (!w) return res.status(404).json({ error: 'Window not found' });

  const ok = db
    .prepare(`UPDATE lead_pool SET state='owned' WHERE id=? AND state IN ('reserved','available')`)
    .run(w.lead_id);
  if (!ok.changes) return res.status(410).json({ error: 'Lead already owned/expired' });

  db.prepare(`DELETE FROM lead_windows WHERE id=?`).run(windowId);
  db.prepare(`INSERT INTO claims(lead_id,user_id,action,created_at) VALUES(?,?,?,?)`).run(
    w.lead_id,
    uid,
    'own',
    Date.now()
  );
  const alerts = db.prepare(`SELECT email_on FROM alerts WHERE user_id=?`).get(uid) as any;
  const delta = alerts && alerts.email_on ? 4 : 2;
  db.prepare(`UPDATE users SET fp = MIN(99, fp+?) WHERE id=?`).run(delta, uid);
  db.prepare(`UPDATE abuse SET score = MAX(0, score-1) WHERE user_id=?`).run(uid);

  res.json({ ok: true });
});

app.post('/api/v1/arrange-more', (req, res) => {
  const uid = userId(req);
  const { leadId } = req.body || {};
  const lead = db.prepare(`SELECT cat,kw,platform FROM lead_pool WHERE id=?`).get(leadId) as any;
  if (lead) {
    const now = Date.now();
    const prefs =
      (db
        .prepare(
          `SELECT cat_weights_json,kw_weights_json,plat_weights_json FROM user_prefs WHERE user_id=?`
        )
        .get(uid) as any) || { cat_weights_json: '{}', kw_weights_json: '{}', plat_weights_json: '{}' };
    const cat = JSON.parse(prefs.cat_weights_json || '{}');
    const kw = JSON.parse(prefs.kw_weights_json || '{}');
    const plat = JSON.parse(prefs.plat_weights_json || '{}');
    cat[lead.cat] = (cat[lead.cat] || 0) + 0.4;
    kw[lead.kw] = (kw[lead.kw] || 0) + 0.6;
    plat[lead.platform] = (plat[lead.platform] || 0) + 0.3;
    db.prepare(
      `UPDATE user_prefs SET cat_weights_json=?, kw_weights_json=?, plat_weights_json=?, updated_at=? WHERE user_id=?`
    ).run(JSON.stringify(cat), JSON.stringify(kw), JSON.stringify(plat), now, uid);
    db.prepare(`UPDATE users SET fp = MIN(99, fp+1) WHERE id=?`).run(uid);
    db.prepare(`INSERT INTO claims(lead_id,user_id,action,created_at) VALUES(?,?,?,?)`).run(
      leadId,
      uid,
      'arrange_more',
      now
    );
  }
  res.json({ ok: true });
});

app.post('/api/v1/human-check', (req, res) => {
  const uid = userId(req);
  db.prepare(`UPDATE users SET fp = MIN(99, fp+2) WHERE id=?`).run(uid);
  db.prepare(`DELETE FROM cooldowns WHERE user_id=?`).run(uid);
  res.json({ ok: true, fpDelta: 2 });
});

app.post('/api/v1/alerts', (req, res) => {
  const uid = userId(req);
  const { emailOn } = req.body || {};
  db.prepare(
    `INSERT INTO alerts(user_id,email_on,created_at,updated_at) VALUES(?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET email_on=excluded.email_on, updated_at=excluded.updated_at`
  ).run(uid, emailOn ? 1 : 0, Date.now(), Date.now());
  db.prepare(`UPDATE users SET multipliers_json=json_set(multipliers_json,'$.alerts', ?) WHERE id=?`).run(
    emailOn ? 1.1 : 1.0,
    uid
  );
  res.json({ ok: true });
});

app.post('/api/v1/push/subscribe', (req, res) => {
  const uid = userId(req);
  const sub = req.body;
  saveSubscription(uid, sub);
  res.json({ ok: true });
});

app.get('/api/v1/status', (req, res) => {
  const uid = userId(req);
  const st =
    (db.prepare(`SELECT fp, multipliers_json FROM users WHERE id=?`).get(uid) as any) || {
      fp: 50,
      multipliers_json: '{"verified":1.0,"alerts":1.0,"payment":1.0}'
    };
  const m = JSON.parse(st.multipliers_json || '{}');
  const priority = Math.round(st.fp * (m.verified || 1.0) * (m.alerts || 1.0) * (m.payment || 1.0) * 10) / 10;
  const cd = db.prepare(`SELECT ends_at FROM cooldowns WHERE user_id=?`).get(uid) as any;
  const cooldownSec = cd ? Math.max(0, Math.ceil((cd.ends_at - Date.now()) / 1000)) : 0;
  res.json({ fp: st.fp, cooldownSec, priority, multipliers: m });
});

app.get('/api/v1/lead-explain', (req, res) => {
  const uid = userId(req);
  const leadId = parseInt(req.query.leadId as string, 10);
  const lead = db.prepare(`SELECT * FROM lead_pool WHERE id=?`).get(leadId) as any;
  const prefs = db.prepare(`SELECT * FROM user_prefs WHERE user_id=?`).get(uid) as any;
  const cats = prefs ? JSON.parse(prefs.cat_weights_json || '{}') : {};
  const kws = prefs ? JSON.parse(prefs.kw_weights_json || '{}') : {};
  const plats = prefs ? JSON.parse(prefs.plat_weights_json || '{}') : {};
  const reasons: string[] = [];
  if (cats[lead.cat]) reasons.push(`Matches your category preference: **${lead.cat}** (+${cats[lead.cat].toFixed(1)})`);
  if (kws[lead.kw]) reasons.push(`Keyword you reacted to: **${lead.kw}** (+${kws[lead.kw].toFixed(1)})`);
  if (plats[lead.platform]) reasons.push(`Platform you prefer: **${lead.platform}** (+${plats[lead.platform].toFixed(1)})`);
  reasons.push(`Freshness boost: posted ${Math.round((Date.now() - lead.generated_at) / 60000)} min ago.`);
  reasons.push(`Competition heat: **${lead.heat}**.`);
  res.json({ reasons });
});

const port = process.env.PORT || 8787;
registerBilling(app);
app.listen(port, () => console.log('API up on', port));
