// src/routes/webscout.ts
// WebScout routes with wide compatibility:
// - Paths:  /api/v1/webscout, /api/v1/find, /api/v1/leads (alias for the panel)
// - Inputs: supplierDomain | domain | website, plus optional regions/keywords
// - Output: both {candidates: [...] } and {items: [...]} for table UIs.
//
// No external deps; safe for tsconfig.runtime.json (no esModuleInterop needed).

import * as express from 'express';
import type { Express, Request, Response } from 'express';

// ---------- Types ----------

type Temperature = 'warm' | 'hot';
type WhyKind = 'persona' | 'region' | 'meta' | 'signal';

interface WhyChip {
  label: string;
  kind: WhyKind;
  score: number; // 0..1
  detail: string;
}

interface Candidate {
  id: string;
  host: string;
  platform: 'shopify' | 'woocommerce' | 'bigcommerce' | 'custom' | 'unknown';
  title: string;
  temperature: Temperature;
  created: string;
  why: WhyChip[];
}

interface Persona {
  productOffer: string;
  solves: string;
  buyerTitles: string[];
}

interface WebScoutRequest {
  supplierDomain: string;
  regions?: string[];
  verticals?: string[];
  keywords?: string[];
  sampleDomains?: string[];
}

interface WebScoutResponse {
  ok: true;
  supplier: {
    domain: string;
    persona: Persona;
    inferredFrom: string[];
  };
  candidates: Candidate[];
  // table-friendly alias (same data, flattened)
  items: Array<{
    id: string;
    host: string;
    platform: Candidate['platform'];
    title: string;
    created: string;
    temp: Candidate['temperature'];
    why: string;
  }>;
}

// ---------- Helpers ----------

function nowIso(): string {
  return new Date().toISOString();
}

function isUSCA(reg?: string): boolean {
  if (!reg) return false;
  const s = reg.toLowerCase();
  return (
    s.includes('united states') || s === 'us' || s === 'usa' ||
    s.includes('canada') || s === 'ca' ||
    /\b(ny|sf|la|tx|il|nj|on|bc|qc|ab|mb)\b/.test(s)
  );
}

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
      solves: 'secure pallets, reduce film waste',
      buyerTitles: ['Warehouse Manager', 'Logistics Manager', 'COO'],
    };
    clues.push('domain suggests stretch/shrink');
  } else if (d.includes('label')) {
    persona = {
      productOffer: 'product & shipping labels',
      solves: 'compliant labeling and faster fulfillment',
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

function guessPlatform(host: string): Candidate['platform'] {
  const h = host.toLowerCase();
  if (h.includes('myshopify') || h.includes('shopify')) return 'shopify';
  if (h.includes('woocommerce') || h.includes('wp') || h.includes('wordpress')) return 'woocommerce';
  if (h.includes('bigcommerce')) return 'bigcommerce';
  return 'unknown';
}

function domainQuality(host: string): number {
  const h = host.toLowerCase();
  let s = 0.5;
  if (h.endsWith('.com') || h.endsWith('.ca')) s += 0.2;
  if (h.length >= 6 && h.length <= 22) s += 0.2;
  if (!/[^a-z0-9.-]/.test(h)) s += 0.1;
  return Math.min(1, Math.max(0, s));
}

function buildWhyChips(
  persona: Persona,
  regions: string[] | undefined,
  host: string,
  intent: 'generic' | 'mailers' | 'labels' | 'palletizing'
): WhyChip[] {
  const chips: WhyChip[] = [];

  chips.push({
    label: 'Persona fit',
    kind: 'persona',
    score: 0.7,
    detail: `${persona.productOffer} → ${persona.buyerTitles.join(', ')}`,
  });

  const regionList = (regions && regions.length ? regions : ['US', 'CA']).map(String);
  const hasUSCA = regionList.some(isUSCA);
  chips.push({
    label: 'Region match',
    kind: 'region',
    score: hasUSCA ? 0.9 : 0.5,
    detail: hasUSCA ? 'United States / Canada focus' : `Preferred: ${regionList.join(', ')}`,
  });

  chips.push({
    label: 'Domain quality',
    kind: 'meta',
    score: domainQuality(host),
    detail: host,
  });

  const intentDetail =
    intent === 'palletizing' ? 'pallet, stretch, shrink' :
    intent === 'labels'      ? 'labels, UPC, GS1' :
    intent === 'mailers'     ? 'poly mailers, satchels' :
                               'packaging, shipping';

  chips.push({
    label: 'Intent keywords',
    kind: 'signal',
    score: intent === 'generic' ? 0.6 : 0.8,
    detail: intentDetail,
  });

  return chips;
}

function chipsToText(chips: WhyChip[]): string {
  return chips
    .sort((a, b) => b.score - a.score)
    .map(c => `${c.label}: ${c.detail}`)
    .join(' • ');
}

function demoCandidates(supplierDomain: string, persona: Persona, regions?: string[]): Candidate[] {
  const seeds = [
    { host: 'brand-a.com', title: 'RFP: label refresh', intent: 'labels' as const },
    { host: 'brand-x.com', title: 'RFP: poly mailers',  intent: 'mailers' as const },
    { host: 'example.com', title: 'RFP: palletizing project', intent: 'palletizing' as const },
  ];

  return seeds.map((s, i) => {
    const why = buildWhyChips(persona, regions, s.host, s.intent);
    return {
      id: String(100 + i),
      host: s.host,
      platform: guessPlatform(s.host),
      title: s.title,
      temperature: (s.intent === 'labels' || s.intent === 'mailers' || s.intent === 'palletizing') ? 'hot' : 'warm',
      created: nowIso(),
      why,
    };
  });
}

// Accept JSON body, form body, or query params; normalize to WebScoutRequest
function readInput(req: Request): WebScoutRequest | { error: string } {
  const src: any = { ...(req.query || {}), ...(req.body || {}) };

  const rawDomain: unknown =
    src.supplierDomain ?? src.domain ?? src.website ?? src.host ?? src.url ?? '';

  const supplierDomain = String(rawDomain || '').trim().toLowerCase();

  if (!supplierDomain) return { error: 'supplierDomain/domain is required' };

  const regions = Array.isArray(src.regions)
    ? (src.regions as string[])
    : (typeof src.regions === 'string' && src.regions.length
        ? String(src.regions).split(/[,\s/]+/).filter(Boolean)
        : (typeof src.geo === 'string' ? String(src.geo).split(/[,\s/]+/).filter(Boolean) : undefined));

  const verticals = Array.isArray(src.verticals)
    ? (src.verticals as string[])
    : (typeof src.verticals === 'string' ? String(src.verticals).split(/[,\s/]+/).filter(Boolean) : undefined);

  const keywords = Array.isArray(src.keywords)
    ? (src.keywords as string[])
    : (typeof src.keywords === 'string' ? String(src.keywords).split(/[,\s/]+/).filter(Boolean) : undefined);

  const sampleDomains = Array.isArray(src.sampleDomains)
    ? (src.sampleDomains as string[])
    : (typeof src.sampleDomains === 'string' ? String(src.sampleDomains).split(/[,\s/]+/).filter(Boolean) : undefined);

  return { supplierDomain, regions, verticals, keywords, sampleDomains };
}

function handleWebscout(req: Request, res: Response) {
  const parsed = readInput(req);
  if ('error' in parsed) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const supplierDomain = parsed.supplierDomain;
  const { persona, clues } = inferPersona(supplierDomain);
  const candidates = demoCandidates(supplierDomain, persona, parsed.regions);

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
    supplier: {
      domain: supplierDomain,
      persona,
      inferredFrom: clues,
    },
    candidates,
    items,
  };

  return res.json(payload);
}

// ---------- Mount ----------

export default function mountWebscout(app: Express): void {
  const router = express.Router();

  router.get('/webscout/ping', (_req, res) =>
    res.json({ ok: true, pong: true, time: nowIso() })
  );

  // Accept both JSON and URL-encoded forms
  router.use(express.json({ limit: '256kb' }));
  router.use(express.urlencoded({ extended: true }));

  // Primary + aliases
  router.post('/webscout', handleWebscout);
  router.get('/webscout', handleWebscout); // allow GET with query for testing
  router.post('/find', handleWebscout);
  router.get('/find', handleWebscout);
  router.post('/leads', handleWebscout);   // panel legacy path
  router.get('/leads', handleWebscout);

  app.use('/api/v1', router);
}
