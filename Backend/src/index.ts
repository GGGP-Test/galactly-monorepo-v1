import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { migrate, q } from './db';
import { nowPlusMinutes } from './util';
import { findAdvertisersFree } from './connectors/adlib_free';
import { scanPDP } from './connectors/pdp';
import { scanBrandIntake } from './brandintake';

// -------------------------------------------------
// App & middleware
// -------------------------------------------------
const app = express();
app.use(express.json({ limit: '250kb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BRANDS_FILE = process.env.BRANDS_FILE || '';

// attach user id from header (optional)
app.use((req, _res, next) => {
  (req as any).userId = req.header('x-galactly-user') || null;
  next();
});

// -------------------------------------------------
// Helpers
// -------------------------------------------------
function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN;
}

async function insertLead(row: {
  platform: string;
  source_url: string;
  title?: string | null;
  snippet?: string | null;
  kw?: string[];
  cat?: string;
  heat?: number;
}) {
  const cat = row.cat || 'demand';
  const kw = row.kw || [];
  const heat = Math.max(30, Math.min(95, Number(row.heat ?? 70)));
  await q(
    `INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet, state, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'available', now())
     ON CONFLICT (source_url) DO NOTHING`,
    [cat, kw, row.platform, heat, row.source_url, row.title || null, row.snippet || null]
  );
}

function hostFrom(input: string): string | null {
  try {
    const s = input.trim();
    if (!s) return null;
    const u = s.includes('://') ? new URL(s) : new URL('https://' + s);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// -------------------------------------------------
// Basics & debug
// -------------------------------------------------
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
    { path: '/api/v1/find-now', methods: ['post'] },
  ]);
});

app.get('/api/v1/status', (_req, res) => res.json({ ok: true, mode: 'vendor-signals' }));

app.get('/api/v1/debug/peek', async (_req, res) => {
  try {
    const a = await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`);
    const t = await q(`SELECT COUNT(*) FROM lead_pool`);
    res.json({
      ok: true,
      counts: {
        leads_available: Number(a.rows[0]?.count || 0),
        leads_total: Number(t.rows[0]?.count || 0),
      },
      env: { BRANDS_FILE: !!BRANDS_FILE, BRANDS_FILE_PATH: BRANDS_FILE || null },
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// -------------------------------------------------
// Users & events
// -------------------------------------------------
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

app.post('/api/v1/events', async (req, res) => {
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = (req.body || {}) as any;
  if (!leadId || !type) return res.status(400).json({ ok: false, error: 'bad request' });
  await q(
    `INSERT INTO event_log (user_id, lead_id, event_type, meta)
     VALUES ($1,$2,$3,$4)`,
    [userId, Number(leadId), String(type), meta || {}]
  );
  res.json({ ok: true });
});

// -------------------------------------------------
// Leads feed + claim/own
// -------------------------------------------------
app.get('/api/v1/leads', async (_req, res) => {
  const r = await q(
    `SELECT id, cat, kw, platform, heat, source_url, title, snippet, ttl, state, created_at
       FROM lead_pool WHERE state='available'
       ORDER BY created_at DESC
       LIMIT 40`
  );
  let leads = r.rows as any[];

  if (!leads.length) {
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
      created_at: new Date().toISOString(),
    }];
  }
  res.json({ ok: true, leads, nextRefreshSec: 20 });
});

app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = (req.body || {}) as any;
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || Number(leadId) < 0)
    return res.json({ ok: true, demo: true, reservedForSec: 120, reveal: null });

  const windowId = randomUUID();
  const reservedUntil = nowPlusMinutes(2).toISOString();

  const r = await q(
    `UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now()
     WHERE id=$2 AND state='available' RETURNING id`,
    [userId, Number(leadId)]
  );
  if (r.rowCount === 0) return res.status(409).json({ ok: false, error: 'not available' });

  await q(
    `INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until)
     VALUES($1,$2,$3,$4)`,
    [windowId, Number(leadId), userId, reservedUntil]
  );
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`, [userId, Number(leadId)]);
  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId;
  const { windowId } = (req.body || {}) as any;
  if (!userId || !windowId) return res.status(400).json({ ok: false, error: 'bad request' });

  const r = await q<any>(
    `SELECT lead_id FROM claim_window
       WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`,
    [String(windowId), String(userId)]
  );
  const leadId = r.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });

  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, Number(leadId)]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, Number(leadId)]);
  res.json({ ok: true });
});

// -------------------------------------------------
// Admin (legacy)
// -------------------------------------------------
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
      await q(`INSERT INTO brand(name, domain, sector) VALUES ($1,$2,$3) ON CONFLICT (domain) DO NOTHING`, [name, domain, sector]);
      inserted++;
    } catch { skipped++; }
  }
  res.json({ ok: true, inserted, skipped, total: lines.length });
});

app.post('/api/v1/admin/ingest', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  // kept for compatibility – collectors may call this later
  res.json({ ok: true, did: 'noop' });
});

// -------------------------------------------------
// NEW: On‑demand buyer discovery for a single vendor
// -------------------------------------------------

// Body schema (any of these are optional):
// {
//   industries?: string[],
//   regions?: string[],
//   keywords?: string[],
//   buyers?: string[],            // explicit buyer domains/URLs
//   examples?: string[],          // example brands to include
//   competitor_domains?: string[] // more seeds
// }

// -------------------- NEW: find-now (user-onboarding, seed-first) --------------------
app.post('/api/v1/find-now', async (req, res) => {
  const vendor = (req.body || {}) as {
    industries?: string[];
    regions?: string[];
    buyers?: string[];     // explicit buyer domains from the user
    examples?: string[];   // example clients (domains)
  };

  const maxDomains = Number(process.env.FIND_MAX_DOMAINS || 30);
  const seen = new Set<string>();
  let created = 0, checked = 0;

  const sanitize = (s?: string) =>
    (s || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();

  try {
    // 1) Build seed domain list from the user (buyers + examples)
    const seedDomains = [
      ...(vendor.buyers || []).map(sanitize),
      ...(vendor.examples || []).map(sanitize),
    ]
      .filter(d => d && d.includes('.')) as string[];

    // 2) Feed seeds to our free "adlib"; this currently just echoes normalized seeds (no paid libs)
    const advertisers = await findAdvertisersFree({
      seeds: seedDomains,
      industries: vendor.industries || [],
      regions: vendor.regions || [],
    });

    // Candidate domains = the advertiser domains (seed-based) de-duped
    const candidates = Array.from(new Set(advertisers.map(a => a.domain))).slice(0, maxDomains);

    // 3) For each candidate domain, run intake + PDP scans and insert leads
    const insertLead = async (row: {
      platform: string;
      source_url: string;
      title?: string | null;
      snippet?: string | null;
      kw?: string[];
      cat?: string;
      heat?: number;
    }) => {
      const cat = row.cat || 'demand';
      const kw = row.kw || [];
      const heat = Math.max(30, Math.min(95, Number(row.heat ?? 70)));
      await q(
        `INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet, state, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'available', now())
         ON CONFLICT (source_url) DO NOTHING`,
        [cat, kw, row.platform, heat, row.source_url, row.title || null, row.snippet || null]
      );
    };

    for (const host of candidates) {
      if (!host) continue;

      // Keep the seed itself as a “proof” card if you want (optional). Skipping to avoid noise.

      // Intake/procurement (supplier/vendor pages)
      try {
        const intakeHits = await scanBrandIntake(host).catch(() => []);
        for (const h of intakeHits) {
          if (!h?.url || seen.has(h.url)) continue;
          await insertLead({
            platform: 'brandintake',
            source_url: h.url,
            title: h.title || `${host} — Supplier/Procurement`,
            snippet: h.snippet || host,
            kw: ['procurement', 'supplier', 'packaging'],
            cat: 'procurement',
            heat: 82,
          });
          seen.add(h.url);
          created++;
        }
      } catch {}

      // PDP / product signals (case-of-N, restock, etc.)
      try {
        const pdpHits = await scanPDP(host).catch(() => []);
        for (const p of pdpHits) {
          if (!p?.url || seen.has(p.url)) continue;
          await insertLead({
            platform: p.type || 'pdp',
            source_url: p.url,
            title: p.title || `${host} product`,
            snippet: p.snippet || '',
            kw: ['case', 'restock', 'sku'],
            cat: 'product',
            heat: p.type === 'restock_post' ? 78 : 68,
          });
          seen.add(p.url);
          created++;
        }
      } catch {}

      checked++;
    }

    return res.json({ ok: true, checked, created, advertisers: advertisers.length });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


// -------------------------------------------------
// Start
// -------------------------------------------------
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`galactly-api listening on :${PORT}`));
});
