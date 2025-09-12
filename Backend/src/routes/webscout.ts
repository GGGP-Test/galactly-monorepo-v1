// src/routes/webscout.ts
// Accepts multiple legacy/modern endpoints and payload shapes for "find buyers".
// No esModuleInterop required.

import * as express from 'express';
import type { Express, Request, Response } from 'express';

// ---------- Types ----------
type Temperature = 'warm' | 'hot';
type WhyKind = 'persona' | 'region' | 'meta' | 'signal';

interface WhyChip { label: string; kind: WhyKind; score: number; detail: string; }
interface Candidate {
  id: string; host: string; platform: 'shopify'|'woocommerce'|'bigcommerce'|'custom'|'unknown';
  title: string; temperature: Temperature; created: string; why: WhyChip[];
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
const looksLikeDomain = (s: string) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s);
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
const chipsToText = (chips: WhyChip[]) =>
  chips.sort((a, b) => b.score - a.score).map(c => `${c.label}: ${c.detail}`).join(' • ');

// ---------- Domain extraction (very forgiving) ----------
function pluckDomain(src: unknown): string | undefined {
  if (!src) return undefined;

  if (typeof src === 'string') {
    const s = src.trim();
    if (looksLikeDomain(s)) return s.toLowerCase();
    // tolerate raw URL
    try {
      const u = new URL(s);
      if (looksLikeDomain(u.hostname)) return u.hostname.toLowerCase();
    } catch {}
    return undefined;
  }

  if (typeof src === 'object') {
    const obj = src as Record<string, unknown>;
    const primaryKeys = ['supplierDomain','domain','website','host','url'];
    for (const k of primaryKeys) {
      const v = obj[k];
      const got = pluckDomain(v);
      if (got) return got;
    }
    // search nested
    for (const v of Object.values(obj)) {
      const got = pluckDomain(v);
      if (got) return got;
    }
  }
  return undefined;
}

function readDomain(req: Request): string | undefined {
  // 1) text/plain bodies
  if (typeof (req as any).body === 'string') {
    const got = pluckDomain((req as any).body);
    if (got) return got;
  }
  // 2) JSON / urlencoded body
  const fromBody = pluckDomain((req as any).body);
  if (fromBody) return fromBody;
  // 3) query string
  const fromQuery = pluckDomain(req.query as any);
  if (fromQuery) return fromQuery;
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

// ---------- Mount ----------
export default function mountWebscout(app: Express): void {
  const router = express.Router();

  // Accept JSON, URL-encoded forms, and text/plain (some panels send raw text)
  router.use(express.text({ type: ['text/*'] }));
  router.use(express.json({ limit: '256kb' }));
  router.use(express.urlencoded({ extended: true }));

  router.get('/webscout/ping', (_req, res) => res.json({ ok: true, pong: true, time: nowIso() }));

  // Primary and aliases used by various panel builds
  router.post('/webscout', handleFind);
  router.get('/webscout', handleFind);

  router.post('/find', handleFind);
  router.get('/find', handleFind);

  router.post('/leads', handleFind);
  router.get('/leads', handleFind);

  // Panels that call nested actions:
  router.post('/leads/find', handleFind);
  router.get('/leads/find', handleFind);
  router.post('/leads/find-buyers', handleFind);
  router.get('/leads/find-buyers', handleFind);

  app.use('/api/v1', router);
}
