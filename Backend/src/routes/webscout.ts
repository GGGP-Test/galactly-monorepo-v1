// src/routes/webscout.ts
// Universal "find buyers" route: very forgiving domain extraction + legacy paths.
// Works with JSON, x-www-form-urlencoded, text/plain, missing content-type, and query strings.

import * as express from 'express';
import type { Express, Request, Response } from 'express';

// ---------- Types ----------
type Temperature = 'warm' | 'hot';
type WhyKind = 'persona' | 'region' | 'meta' | 'signal';
interface WhyChip { label: string; kind: WhyKind; score: number; detail: string; }
interface Candidate {
  id: string;
  host: string;
  platform: 'shopify'|'woocommerce'|'bigcommerce'|'custom'|'unknown';
  title: string;
  temperature: Temperature;
  created: string;
  why: WhyChip[];
}
interface Persona { productOffer: string; solves: string; buyerTitles: string[]; }
interface WebScoutResponse {
  ok: true;
  supplier: { domain: string; persona: Persona; inferredFrom: string[]; };
  candidates: Candidate[];
  items: Array<{ id: string; host: string; platform: Candidate['platform']; title: string; created: string; temp: Candidate['temperature']; why: string; }>;
}

// ---------- Small utils ----------
const nowIso = () => new Date().toISOString();
const guessPlatform = (h: string): Candidate['platform'] => {
  const x = h.toLowerCase();
  if (x.includes('shopify')) return 'shopify';
  if (x.includes('woocommerce') || x.includes('wp')) return 'woocommerce';
  if (x.includes('bigcommerce')) return 'bigcommerce';
  return 'unknown';
};
const domainQuality = (h: string) => {
  let s = 0.5;
  const L = h.length;
  if (h.endsWith('.com') || h.endsWith('.ca')) s += 0.2;
  if (L >= 6 && L <= 22) s += 0.2;
  if (!/[^a-z0-9.-]/i.test(h)) s += 0.1;
  return Math.min(1, Math.max(0, s));
};
const chipsToText = (chips: WhyChip[]) =>
  chips.sort((a, b) => b.score - a.score).map(c => `${c.label}: ${c.detail}`).join(' • ');

// ---------- Persona heuristics ----------
function inferPersona(domain: string): { persona: Persona; clues: string[] } {
  const d = domain.toLowerCase();
  const clues: string[] = [];
  let persona: Persona = {
    productOffer: 'protective & shipping packaging',
    solves: 'reduce transit damage; speed pick/pack',
    buyerTitles: ['Operations Manager', 'Procurement Manager', 'COO'],
  };
  if (d.includes('stretch') || d.includes('shrink')) {
    persona = {
      productOffer: 'palletizing stretch/shrink film',
      solves: 'secure pallets; cut film waste',
      buyerTitles: ['Warehouse Manager', 'Logistics Manager', 'COO'],
    };
    clues.push('domain suggests stretch/shrink');
  } else if (d.includes('label')) {
    persona = {
      productOffer: 'product & shipping labels',
      solves: 'compliant labeling; faster fulfillment',
      buyerTitles: ['E-commerce Ops', 'Plant Manager', 'Procurement'],
    };
    clues.push('domain suggests labels');
  } else if (d.includes('mailer') || d.includes('poly')) {
    persona = {
      productOffer: 'poly mailers & e-com packaging',
      solves: 'lower DIM weight; protect parcels',
      buyerTitles: ['E-commerce Ops', 'Fulfillment Lead', 'Procurement'],
    };
    clues.push('domain suggests mailers');
  } else {
    clues.push('generic packaging heuristics');
  }
  return { persona, clues };
}
function buildWhy(host: string, persona: Persona): WhyChip[] {
  return [
    { label: 'Persona fit', kind: 'persona', score: 0.7, detail: `${persona.productOffer} → ${persona.buyerTitles.join(', ')}` },
    { label: 'Region match', kind: 'region', score: 0.9, detail: 'United States / Canada focus' },
    { label: 'Domain quality', kind: 'meta', score: domainQuality(host), detail: host },
    { label: 'Intent keywords', kind: 'signal', score: 0.8, detail: 'pallet, stretch, shrink / labels / mailers' },
  ];
}

// ---------- Domain extraction (ultra-forgiving) ----------
const DOMAIN_RX = /([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;
function looksLikeDomain(s: string): string | undefined {
  // Accept hostnames and full URLs; return hostname if found.
  const t = s.trim();
  try {
    const u = new URL(t);
    return u.hostname.toLowerCase();
  } catch {/* not a full URL */}
  const m = t.match(DOMAIN_RX);
  return m ? m[1].toLowerCase() : undefined;
}

function pluckDomain(src: unknown): string | undefined {
  if (!src) return undefined;

  if (typeof src === 'string') return looksLikeDomain(src);

  if (typeof src === 'object') {
    const obj = src as Record<string, unknown>;
    // cover all likely keys sent by various panels
    const keys = [
      'supplierDomain','domain','website','host','url',
      'supplier','company','companyDomain','brand',
      'text','value','q','query','search','keyword','keywords'
    ];
    for (const k of keys) {
      if (k in obj) {
        const got = pluckDomain(obj[k]);
        if (got) return got;
      }
    }
    // if nested unknown, scan values
    for (const v of Object.values(obj)) {
      const got = pluckDomain(v);
      if (got) return got;
    }
  }
  return undefined;
}

function readDomain(req: Request): string | undefined {
  // 1) headers (allow X-Domain for simple testing)
  const hd = (req.headers['x-domain'] || req.headers['x-website'] || '') as string;
  const fromHeader = looksLikeDomain(hd || '');
  if (fromHeader) return fromHeader;

  // 2) any parsed body (json / urlencoded / text parsers)
  const bodyAny = (req as any).body;
  const fromBody = pluckDomain(bodyAny);
  if (fromBody) return fromBody;

  // 3) raw body if no parser matched (missing/odd content-type)
  const raw = (req as any).rawBody as string | undefined;
  const fromRaw = raw ? looksLikeDomain(raw) : undefined;
  if (fromRaw) return fromRaw;

  // 4) query string and even the whole originalUrl
  const fromQuery = pluckDomain(req.query as any);
  if (fromQuery) return fromQuery;
  const qs = req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '';
  if (qs) {
    const got = looksLikeDomain(decodeURIComponent(qs));
    if (got) return got;
    const sp = new URLSearchParams(qs);
    for (const [, v] of sp) {
      const d = looksLikeDomain(v);
      if (d) return d;
    }
  }
  return undefined;
}

// ---------- Handler ----------
function handleFind(req: Request, res: Response) {
  const supplierDomain = readDomain(req);
  if (!supplierDomain) {
    return res.status(400).json({ ok: false, error: 'domain is required' });
  }

  const { persona, clues } = inferPersona(supplierDomain);
  const seeds = [
    { host: 'brand-a.com', title: 'RFP: label refresh' },
    { host: 'brand-x.com', title: 'RFP: poly mailers'  },
    { host: 'example.com', title: 'RFP: palletizing project' },
  ];

  const candidates: Candidate[] = seeds.map((s, i) => {
    const why = buildWhy(s.host, persona);
    return {
      id: String(100 + i),
      host: s.host,
      platform: guessPlatform(s.host),
      title: s.title,
      temperature: 'hot',
      created: nowIso(),
      why,
    };
  });

  const items = candidates.map(c => ({
    id: c.id,
    host: c.host,
    platform: c.platform,
    title: c.title,
    created: c.created,
    temp: c.temperature,
    why: chipsToText(c.why),
  }));

  const payload: WebScoutResponse = {
    ok: true,
    supplier: { domain: supplierDomain, persona, inferredFrom: clues },
    candidates,
    items,
  };
  return res.json(payload);
}

// ---------- Mount (with robust body intake) ----------
export default function mountWebscout(app: Express): void {
  const router = express.Router();

  // Capture raw body for any content-type (fallback)
  router.use((req, _res, next) => {
    if ((req as any)._rawCaptured) return next();
    (req as any)._rawCaptured = true;

    // If body already parsed by prior middleware, skip
    if ((req as any).body !== undefined) return next();

    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      (req as any).rawBody = data;
      // Best-effort: if it parses as JSON, expose it on req.body, else leave as string
      try { (req as any).body = data ? JSON.parse(data) : undefined; } catch { (req as any).body = data; }
      next();
    });
  });

  // Also accept typical body types
  router.use(express.text({ type: ['text/*', 'application/octet-stream'] }));
  router.use(express.json({ limit: '256kb' }));
  router.use(express.urlencoded({ extended: true }));

  router.get('/webscout/ping', (_req, res) => res.json({ ok: true, pong: true, time: nowIso() }));

  // Primary and legacy aliases used by panels
  const attach = (p: string) => { router.post(p, handleFind); router.get(p, handleFind); };
  attach('/webscout');
  attach('/find');
  attach('/leads');
  attach('/leads/find');
  attach('/leads/find-buyers');

  app.use('/api/v1', router);
}
