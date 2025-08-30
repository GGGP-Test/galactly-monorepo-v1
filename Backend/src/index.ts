import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { randomUUID } from 'crypto';

import { migrate, q } from './db';
import { nowPlusMinutes } from './util';
import { computeScore, type Weights, type UserPrefs } from './scoring';

import { scanBrandIntake } from './brandintake';
import { scanPDP } from './connectors/pdp';
import { findAdvertisersFree } from './connectors/adlib_free';
import { deriveBuyersFromVendorSite } from './connectors/derivebuyersfromvendorsite';

// -------------------- app & CORS --------------------
const app = express();
app.use(express.json({ limit: '300kb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, x-galactly-user, x-admin-token'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// attach user id from header
app.use((req, _res, next) => {
  (req as any).userId = req.header('x-galactly-user') || null;
  next();
});

// -------------------- helpers --------------------
function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN;
}

function normHost(s?: string) {
  if (!s) return '';
  let h = s.trim();
  if (!h) return '';
  h = h.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const slash = h.indexOf('/');
  return slash > 0 ? h.slice(0, slash) : h;
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
    `
    INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet, state, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'available', now())
    ON CONFLICT (source_url) DO NOTHING
  `,
    [cat, kw, row.platform, heat, row.source_url, row.title ?? null, row.snippet ?? null]
  );
}

async function runSafely<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

// per-user boost if they previously confirmed a proof for this host
function confirmBoostFor(url: string, prefs?: any): number {
  try {
    if (!prefs) return 0;
    const host = new URL(url).hostname.toLowerCase();
    const list = Array.isArray(prefs.confirmedProofs) ? prefs.confirmedProofs : [];
    const has = list.some(
      (r: any) =>
        typeof r?.host === 'string' &&
        host.endsWith(String(r.host).toLowerCase())
    );
    return has ? 0.25 : 0; // feed scorer will add this on top
  } catch {
    return 0;
  }
}

// simple platform diversification (no long runs from same platform)
function diversify<T extends { platform?: string }>(items: T[], max = 20): T[] {
  const byPlat = new Map<string, T[]>();
  for (const it of items) {
    const p = (it.platform || 'misc').toLowerCase();
    if (!byPlat.has(p)) byPlat.set(p, []);
    byPlat.get(p)!.push(it);
  }
  // sort each bucket by creation order already present
  for (const arr of byPlat.values()) {
    // keep as-is; upstream is already DESC by created_at; we don't reorder
  }
  const keys = Array.from(byPlat.keys());
  const out: T[] = [];
  let idx = 0;
  let lastPlat = '';
  while (out.length < Math.min(max, items.length)) {
    const p = keys[idx % keys.length];
    idx++;
    if (p === lastPlat) continue; // skip to avoid repetition
    const bucket = byPlat.get(p)!;
    const next = bucket.shift();
    if (!next) {
      // remove empty bucket
      byPlat.delete(p);
      const i = keys.indexOf(p);
      if (i >= 0) keys.splice(i, 1);
      if (!keys.length) break;
      continue;
    }
    out.push(next);
    lastPlat = p;
  }
  // if we still need more, append remaining in any order without caring about repetition
  if (out.length < Math.min(max, items.length)) {
    const rest: T[] = [];
    for (const arr of byPlat.values()) rest.push(...arr);
    out.push(...rest.slice(0, max - out.length));
  }
  return out;
}

// -------------------- basics --------------------
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
app.get('/api/v1/status', (_req, res) =>
  res.json({ ok: true, mode: 'vendor-signals' })
);

// -------------------- users --------------------
app.post('/api/v1/gate', async (req, res) => {
  const userId = (req as any).userId;
  if (!userId)
    return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  const { region, email, alerts } = (req.body as any) || {};
  await q(
    `
    INSERT INTO app_user(id,region,email,alerts)
    VALUES ($1,$2,$3,COALESCE($4,false))
    ON CONFLICT (id) DO UPDATE
      SET region=EXCLUDED.region,
          email=EXCLUDED.email,
          alerts=EXCLUDED.alerts,
          updated_at=now()
  `,
    [userId, region || null, email || null, alerts === true]
  );
  res.json({ ok: true });
});

// -------------------- events (like/dislike/mute/confirm) --------------------
app.post('/api/v1/events', async (req, res) => {
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = (req.body as any) || {};
  if (!leadId || !type)
    return res.status(400).json({ ok: false, error: 'bad request' });

  await q(
    `INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)`,
    [userId, leadId, String(type), meta || {}]
  );

  // per-user confirmation of ad proof (no global heat bump)
  if (String(type) === 'confirm_ad' && userId) {
    const host = (() => {
      try {
        return new URL(meta?.url || '').hostname;
      } catch {
        return meta?.domain || null;
      }
    })();
    const platform = String(meta?.platform || 'adlib_free').toLowerCase();
    if (host) {
      // append to user_prefs.confirmedProofs (jsonb array)
      await q(
        `
        UPDATE app_user
           SET user_prefs = jsonb_set(
             COALESCE(user_prefs,'{}'::jsonb),
             '{confirmedProofs}',
             COALESCE(user_prefs->'confirmedProofs','[]'::jsonb)
               || jsonb_build_array(jsonb_build_object('host',$2,'platform',$3,'ts', now()))
           )
         WHERE id=$1
      `,
        [userId, host, platform]
      );
    }
  }

  // mute domain into user_prefs.muteDomains
  if (String(type) === 'mute_domain' && userId && meta?.domain) {
    await q(
      `
      UPDATE app_user
         SET user_prefs = jsonb_set(
           COALESCE(user_prefs,'{}'::jsonb),
           '{muteDomains}',
           COALESCE(user_prefs->'muteDomains','[]'::jsonb) || to_jsonb($2::text)
         )
       WHERE id=$1
    `,
      [userId, String(meta.domain)]
    );
  }

  res.json({ ok: true });
});

// -------------------- feed --------------------
app.get('/api/v1/leads', async (req, res) => {
  const userId = (req as any).userId || null;
  const limit = 60;

  const r = await q(
    `
    SELECT id, cat, kw, platform, heat, source_url, title, snippet, ttl, state, created_at
    FROM lead_pool
    WHERE state='available'
    ORDER BY created_at DESC
    LIMIT $1
  `,
  [limit]);

  let leads = r.rows as any[];

  // load model weights (optional; fall back if missing)
  const wRow = await q<{ weights: any }>(
    `SELECT weights FROM model_state WHERE segment='global'`
  );
  const weights: Weights =
    (wRow.rows[0]?.weights as Weights) ||
    ({
      coeffs: {
        recency: 0.4,
        platform: 1.0,
        domain: 0.5,
        intent: 0.6,
        histCtr: 0.3,
        userFit: 1.0
      },
      platforms: {},
      badDomains: []
    } as any);

  // user prefs (for boosts / mutes / confirmBoost)
  let prefs: UserPrefs | undefined;
  if (userId) {
    const pr = await q<{ user_prefs: any }>(
      'SELECT user_prefs FROM app_user WHERE id=$1',
      [userId]
    );
    prefs = pr.rows[0]?.user_prefs || undefined;
  }

  // score + confirm boost
  const scored = leads.map((L) => {
    const base = computeScore(L, weights, prefs);
    const plus = confirmBoostFor(L.source_url, prefs);
    return { ...L, _score: base + plus };
  });

  // sort by score then diversify by platform
  scored.sort((a, b) => b._score - a._score);
  const diversified = diversify(scored, 20);

  // ensure some cards show even when empty
  let finalLeads = diversified as any[];
  if (!finalLeads.length) {
    finalLeads = [
      {
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
      }
    ];
  }

  // impression logging (soft)
  if (userId && finalLeads.length) {
    const values = finalLeads
      .filter((L) => Number(L.id) > 0)
      .map(
        (L) =>
          `('${userId}', ${Number(L.id)}, 'impression', now(), '{}'::jsonb)`
      )
      .join(',');
    if (values) {
      await q(
        `INSERT INTO event_log (user_id, lead_id, event_type, created_at, meta) VALUES ${values}`
      );
    }
  }

  res.json({
    ok: true,
    leads: finalLeads.map(({ _score, ...rest }) => rest),
    nextRefreshSec: 20
  });
});

// -------------------- claim / own --------------------
app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = (req.body as any) || {};
  if (!userId)
    return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || leadId < 0)
    return res.json({
      ok: true,
      demo: true,
      reservedForSec: 120,
      reveal: null
    });

  const windowId = randomUUID();
  const reservedUntil = nowPlusMinutes(2).toISOString();

  const r = await q(
    `
    UPDATE lead_pool
       SET state='reserved', reserved_by=$1, reserved_at=now()
     WHERE id=$2 AND state='available'
     RETURNING id
  `,
    [userId, leadId]
  );
  if (r.rowCount === 0)
    return res.status(409).json({ ok: false, error: 'not available' });

  await q(
    `
    INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until)
    VALUES ($1,$2,$3,$4)
  `,
    [windowId, leadId, userId, reservedUntil]
  );
  await q(
    `INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`,
    [userId, leadId]
  );

  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId;
  const { windowId } = (req.body as any) || {};
  if (!userId || !windowId)
    return res.status(400).json({ ok: false, error: 'bad request' });

  const r = await q<{ lead_id: number }>(
    `
    SELECT lead_id
      FROM claim_window
     WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()
  `,
    [windowId, userId]
  );
  const leadId = r.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });

  await q(
    `UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`,
    [userId, leadId]
  );
  await q(
    `INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`,
    [userId, leadId]
  );

  res.json({ ok: true });
});

// -------------------- admin (legacy) --------------------
app.post('/api/v1/admin/seed-brands', async (req, res) => {
  // Legacy helper: read BRANDS_FILE and try intake scan per domain (no brand table required)
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const BRANDS_FILE = process.env.BRANDS_FILE || '';
  if (!BRANDS_FILE || !fs.existsSync(BRANDS_FILE)) {
    return res.json({ ok: false, error: 'BRANDS_FILE missing' });
  }
  const raw = fs.readFileSync(BRANDS_FILE, 'utf8');
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let checked = 0, created = 0;
  for (const line of lines) {
    const domain = normHost(line.split(',')[0] || '');
    if (!domain) continue;
    const hits = (await runSafely(scanBrandIntake(domain))) || [];
    for (const h of hits) {
      await insertLead({
        platform: 'brandintake',
        source_url: h.url,
        title: h.title || `${domain} — Supplier/Procurement`,
        snippet: h.snippet || domain,
        kw: ['procurement', 'supplier', 'packaging'],
        cat: 'procurement',
        heat: 82
      });
      created++;
    }
    checked++;
  }
  res.json({ ok: true, checked, created, total: lines.length });
});

app.post('/api/v1/admin/ingest', async (req, res) => {
  // keep for compatibility; collectors may call this later
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  res.json({ ok: true, did: 'noop' });
});

// -------------------- debug --------------------
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
        BRANDS_FILE: !!process.env.BRANDS_FILE,
        BRANDS_FILE_PATH: process.env.BRANDS_FILE || null
      }
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// -------------------- NEW: /api/v1/find-now --------------------
app.post('/api/v1/find-now', async (req, res) => {
  const started = Date.now();
  const body = (req.body as any) || {};
  const buyersRaw: string[] = Array.isArray(body.buyers) ? body.buyers : [];
  const industries: string[] = Array.isArray(body.industries) ? body.industries : [];
  const regions: string[] = Array.isArray(body.regions) ? body.regions : [];
  const vendorDomain: string | undefined = typeof body.vendorDomain === 'string' ? body.vendorDomain : undefined;

  let seedDomains = buyersRaw.map(normHost).filter(Boolean);

  // If no buyers provided, derive from vendor site
  if ((!seedDomains.length) && vendorDomain) {
    const icp = (await runSafely(deriveBuyersFromVendorSite(vendorDomain))) || { buyers: [] };
    const derived = Array.isArray(icp.buyers) ? icp.buyers.map((b: any) => normHost(b.domain)).filter(Boolean) : [];
    seedDomains = derived.slice(0, Number(process.env.FIND_MAX_DOMAINS || 40));
    // Optional: store a couple proof leads from icp if they exist
    if (Array.isArray(icp.proofs)) {
      for (const p of icp.proofs.slice(0, 5)) {
        if (p?.url) {
          await insertLead({
            platform: 'icp',
            source_url: p.url,
            title: p.title || `${vendorDomain} ICP clue`,
            snippet: p.snippet || '',
            kw: ['icp', 'clue'],
            cat: 'demand',
            heat: 60
          });
        }
      }
    }
  }

  // 1) expand via free ad libraries (query URLs as proof)
  const advertisers =
    (await runSafely(findAdvertisersFree({ industries, regions, seedDomains }))) || [];
  const advDomains = advertisers.map((a: any) => normHost(a.domain)).filter(Boolean);

  // union & cap
  const domainSet = new Set<string>([...seedDomains, ...advDomains]);
  const domains = Array.from(domainSet).slice(
    0,
    Number(process.env.FIND_MAX_DOMAINS || 40)
  );

  let created = 0,
    checked = 0;
  const seenUrl = new Set<string>();

  for (const host of domains) {
    // 1a) keep ad proof links (so vendors can DIY verify)
    for (const a of advertisers.filter((x: any) => normHost(x.domain) === host)) {
      if (a.proofUrl && !seenUrl.has(a.proofUrl)) {
        await insertLead({
          platform: 'adlib_free',
          source_url: a.proofUrl,
          title: `${host} — ad transparency search`,
          snippet: `Source: ${a.source || 'ads'} • Last seen: ${a.lastSeen || 'recent'} • ~${a.adCount ?? '?'} creatives`,
          kw: ['ads', 'buyer', 'spend'],
          cat: 'demand',
          heat: 70
        });
        seenUrl.add(a.proofUrl);
        created++;
      }
    }

    // 1b) intake/procurement on domain
    const intakeHits = (await runSafely(scanBrandIntake(host))) || [];
    for (const h of intakeHits) {
      if (!seenUrl.has(h.url)) {
        await insertLead({
          platform: 'brandintake',
          source_url: h.url,
          title: h.title || `${host} — Supplier/Procurement`,
          snippet: h.snippet || host,
          kw: ['procurement', 'supplier', 'packaging'],
          cat: 'procurement',
          heat: 82
        });
        seenUrl.add(h.url);
        created++;
      }
    }

    // 1c) PDP / product signals
    const pdpHits = (await runSafely(scanPDP(host))) || [];
    for (const p of pdpHits) {
      if (!seenUrl.has(p.url)) {
        await insertLead({
          platform: p.type || 'pdp',
          source_url: p.url,
          title: p.title || `${host} product`,
          snippet: p.snippet || '',
          kw: ['case', 'pack', 'dims'],
          cat: 'product',
          heat: p.type === 'restock_post' ? 78 : 68
        });
        seenUrl.add(p.url);
        created++;
      }
    }

    checked++;
  }

  res.json({
    ok: true,
    checked,
    created,
    advertisers: advertisers.length,
    tookMs: Date.now() - started
  });
});

// -------------------- start --------------------
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`galactly-api listening on :${PORT}`)
  );
});
