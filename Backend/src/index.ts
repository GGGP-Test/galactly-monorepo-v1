// Backend/src/index.ts
import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { migrate, q } from './db';
import { nowPlusMinutes } from './util';
import { scanBrandIntake } from './brandintake';
import { scanPDP } from './connectors/pdp';
import { findAdvertisersFree } from './connectors/adlib_free';

const app = express();
app.use(express.json({ limit: '250kb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ENV
const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BRANDS_FILE = process.env.BRANDS_FILE || ''; // optional legacy

// attach user id
app.use((req, _res, next) => {
  (req as any).userId = req.header('x-galactly-user') || null;
  next();
});

// ---------- helpers ----------
function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN;
}

function normHost(s: string): string {
  try {
    if (!s) return '';
    // accept full URL or bare domain
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

async function insertLead(row: {
  platform: string; source_url: string;
  title?: string | null; snippet?: string | null;
  kw?: string[]; cat?: string; heat?: number;
}): Promise<boolean> {
  const cat = row.cat ?? 'demand';
  const kw = row.kw ?? [];
  const heat = Math.max(30, Math.min(95, Number(row.heat ?? 70)));
  const r = await q(
    `INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet, state, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'available', now())
     ON CONFLICT (source_url) DO NOTHING`,
    [cat, kw, row.platform, heat, row.source_url, row.title ?? null, row.snippet ?? null]
  );
  // @ts-ignore rowCount exists on pg result
  return (r as any)?.rowCount > 0;
}

// ---------- basics ----------
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.send('galactly-api'));

app.get('/__routes', (_req, res) => {
  res.json([
    { path: '/healthz', methods: ['get'] },
    { path: '/__routes', methods: ['get'] },
    { path: '/whoami', methods: ['get'] },
    { path: '/api/v1/status', methods: ['get'] },
    { path: '/api/v1/gate', methods: ['post'] },
    { path: '/api/v1/leads', methods: ['get'] },
    { path: '/api/v1/claim', methods: ['post'] },
    { path: '/api/v1/own', methods: ['post'] },
    { path: '/api/v1/events', methods: ['post'] },
    { path: '/api/v1/debug/peek', methods: ['get'] },
    { path: '/api/v1/admin/ingest', methods: ['post'] },
    { path: '/api/v1/admin/seed-brands', methods: ['post'] },
    { path: '/api/v1/find-now', methods: ['post'] }
  ]);
});

app.get('/api/v1/status', (_req, res) => res.json({ ok: true, mode: 'vendor-signals' }));

// ---------- presence (optional) ----------
const online: Record<string, number> = {};
app.post('/api/v1/presence/beat', (req, res) => {
  const id = (req as any).userId || randomUUID();
  online[id] = Date.now();
  res.json({ ok: true });
});
app.get('/api/v1/presence/online', (_req, res) => {
  const now = Date.now();
  for (const k of Object.keys(online)) if (now - online[k] > 30000) delete online[k];
  const real = Object.keys(online).length;
  const display = Math.max(34, Math.round(real * 0.9 + 6));
  res.json({ ok: true, real, displayed: display });
});

// ---------- users ----------
app.post('/api/v1/gate', async (req, res) => {
  const userId = (req as any).userId;
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  const { region, email, alerts } = (req.body || {}) as any;
  await q(
    `INSERT INTO app_user(id,region,email,alerts)
     VALUES ($1,$2,$3,COALESCE($4,false))
     ON CONFLICT (id) DO UPDATE SET region=EXCLUDED.region, email=EXCLUDED.email, alerts=EXCLUDED.alerts, updated_at=now()`,
    [userId, region || null, email || null, alerts === true]
  );
  res.json({ ok: true });
});

// ---------- events (likes/mutes/etc.) ----------
app.post('/api/v1/events', async (req, res) => {
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = req.body || {};
  if (!leadId || !type) return res.status(400).json({ ok:false, error:'bad request' });

  // record the event
  await q(`INSERT INTO event_log (user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)`,
          [userId, leadId, String(type), meta || {}]);

  // NEW: user confirmed the ad exists → bump heat + mark verified
  if (type === 'verify_ads') {
    await q(`
      UPDATE lead_pool
      SET
        confidence = LEAST(1.0, COALESCE(confidence,0.5) + 0.25),
        heat       = LEAST(95, GREATEST(COALESCE(heat,60)+15, 70)),
        meta       = jsonb_set(COALESCE(meta,'{}'::jsonb), '{verified_ads}', 'true'::jsonb, true)
      WHERE id=$1
    `, [leadId]);
  }
  res.json({ ok: true });
});

// ---------- leads feed ----------
app.get('/api/v1/leads', async (_req, res) => {
  const r = await q(
    `SELECT id, cat, kw, platform, heat, source_url, title, snippet, ttl, state, created_at
     FROM lead_pool WHERE state='available'
     ORDER BY created_at DESC
     LIMIT 40`
  );
  let leads = r.rows as any[];

  if (!leads.length) {
    // keep 1 demo so UI isn't blank
    leads = [{
      id: -1,
      cat: 'demo',
      kw: ['packaging'],
      platform: 'demo',
      heat: 80,
      source_url: 'https://example.com/proof',
      title: 'Demo HOT lead (signals warming up)',
      snippet: 'This placeholder disappears once your signal ingestors run.',
      ttl: nowPlusMinutes(60).toISOString(),
      state: 'available',
      created_at: new Date().toISOString()
    }];
  }

  res.json({ ok: true, leads, nextRefreshSec: 20 });
});

// ---------- claim / own ----------
app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = (req.body || {}) as any;
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || leadId < 0) return res.json({ ok: true, demo: true, reservedForSec: 120, reveal: null });

  const windowId = randomUUID();
  const reservedUntil = nowPlusMinutes(2).toISOString();

  const r = await q(
    `UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now()
     WHERE id=$2 AND state='available' RETURNING id`,
    [userId, leadId]
  );
  if (r.rowCount === 0) return res.status(409).json({ ok: false, error: 'not available' });

  await q(
    `INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until)
     VALUES($1,$2,$3,$4)`,
    [windowId, leadId, userId, reservedUntil]
  ).catch(() => {});
  await q(
    `INSERT INTO event_log(user_id, lead_id, event_type, meta)
     VALUES ($1,$2,'claim','{}')`,
    [userId, leadId]
  ).catch(() => {});

  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId;
  const { windowId } = (req.body || {}) as any;
  if (!userId || !windowId) return res.status(400).json({ ok: false, error: 'bad request' });

  const r = await q<any>(
    `SELECT lead_id FROM claim_window
     WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`,
    [windowId, userId]
  );
  const leadId = r.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });

  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]).catch(() => {});
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]).catch(() => {});
  res.json({ ok: true });
});

// ---------- admin (legacy) ----------
app.post('/api/v1/admin/seed-brands', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!BRANDS_FILE || !fs.existsSync(BRANDS_FILE)) return res.json({ ok: false, error: 'BRANDS_FILE missing' });

  const raw = fs.readFileSync(BRANDS_FILE, 'utf8');
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let inserted = 0, skipped = 0;
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim());
    const domain = (parts[0] || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!domain) { skipped++; continue; }
    const name = parts[1] || domain;
    const sector = parts[2] || null;
    try {
      await q(
        `INSERT INTO brand(name, domain, sector)
         VALUES ($1,$2,$3) ON CONFLICT (domain) DO NOTHING`,
        [name, domain, sector]
      );
      inserted++;
    } catch {
      skipped++;
    }
  }
  res.json({ ok: true, inserted, skipped, total: lines.length });
});

app.post('/api/v1/admin/ingest', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  res.json({ ok: true, did: 'noop' });
});

// ---------- debug ----------
app.get('/api/v1/debug/peek', async (_req, res) => {
  try {
    const lAvail = await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`);
    const lTotal = await q(`SELECT COUNT(*) FROM lead_pool`);
    res.json({
      ok: true,
      counts: {
        leads_available: Number(lAvail.rows[0]?.count || 0),
        leads_total: Number(lTotal.rows[0]?.count || 0)
      },
      env: {
        BRANDS_FILE: !!BRANDS_FILE,
        BRANDS_FILE_PATH: BRANDS_FILE || null
      }
    });
  } catch (e: any) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------- NEW: find-now (on-demand) ----------
app.post('/api/v1/find-now', async (req, res) => {
  const t0 = Date.now();
  const vendor = req.body || {};
  const buyers: string[] = Array.from(new Set([...(vendor.buyers || []), ...(vendor.exampleBuyers || [])]
    .map((x: string) => x?.toString().trim()).filter(Boolean)));
  
if (adv.proofUrl) {
  await insertLead({
    platform: 'adlib_free',
    source_url: adv.proofUrl,
    title: `${host} — ad proof (${adv.source})`,
    snippet: 'Click to verify in the official library, then tap Verify.',
    kw: ['ads','buyer','spend'],
    cat: 'demand',
    heat: 68  // modest until verified
  });
}

  // If no buyers provided, use brand strings the user typed (industries/brands terms)
  const brands: string[] = (vendor.brands || []).map((x: string) => x?.toString().trim()).filter(Boolean);

  const maxDomains = Number(process.env.FIND_MAX_DOMAINS || 30);
  let created = 0, checked = 0;

  try {
    // 1) Advertiser proof (free)
    const proofs = await findAdvertisersFree(buyers, { brands });
    for (const p of proofs.slice(0, maxDomains)) {
      const ok = await insertLead({
        platform: `ads_${p.source}`,
        source_url: p.proofUrl,
        title: `${p.domain} — active ads (${p.source})`,
        snippet: `Proof page (${p.source.toUpperCase()}). Last seen: ${p.lastSeen}`,
        kw: ['ads', 'buyer', 'spend'],
        cat: 'demand',
        heat: 72
      });
      if (ok) created++;
      checked++;
    }

    // 2) Intake on exact domains
    for (const d of buyers.slice(0, maxDomains)) {
      const host = d.replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase();
      if (!host.includes('.')) continue;
      const intake = await scanBrandIntake(host).catch(() => []);
      for (const h of intake) {
        const ok = await insertLead({
          platform: 'brandintake',
          source_url: h.url,
          title: h.title || `${host} — Supplier / Procurement`,
          snippet: h.snippet || host,
          kw: ['procurement','supplier','packaging'],
          cat: 'procurement',
          heat: 82
        });
        if (ok) created++;
      }
      checked++;
    }

    // 3) PDP / products on the same domains
    for (const d of buyers.slice(0, maxDomains)) {
      const host = d.replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase();
      if (!host.includes('.')) continue;
      const pdps = await scanPDP(host).catch(() => []);
      for (const p of pdps) {
        const ok = await insertLead({
          platform: p.type,
          source_url: p.url,
          title: p.title || `${host} product`,
          snippet: p.snippet || '',
          kw: ['case','pack','dims'],
          cat: 'product',
          heat: p.type === 'restock_post' ? 78 : 68
        });
        if (ok) created++;
      }
      checked++;
    }

    return res.json({ ok: true, checked, created, advertisers: proofs.length, tookMs: Date.now() - t0 });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------- start ----------
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`galactly-api listening on :${PORT}`));
});
