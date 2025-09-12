// src/routes/webscout.ts
// WebScout v0: minimal, dependency-free route with a /find alias.
// NOTE: Keep imports as namespace to avoid esModuleInterop issues.

import * as express from 'express';
import type { Express, Request, Response } from 'express';

type Temperature = 'warm' | 'hot';
type WhyKind = 'persona' | 'region' | 'meta' | 'signal';

interface WhyChip {
  label: string;
  kind: WhyKind;
  score: number;      // 0..1
  detail: string;
}

interface Candidate {
  id: string;
  host: string;
  platform: 'shopify' | 'woocommerce' | 'bigcommerce' | 'custom' | 'unknown';
  title: string;
  temperature: Temperature;
  why: WhyChip[];
}

interface Persona {
  productOffer: string;
  solves: string;
  buyerTitles: string[];
}

interface WebScoutRequest {
  supplierDomain: string;        // required
  regions?: string[];            // preferred regions; default to US/CA bias
  verticals?: string[];          // optional (e.g., retail, food, DTC)
  keywords?: string[];           // optional; if omitted, we infer
  sampleDomains?: string[];      // optional example buyers the user might provide
}

interface WebScoutResponse {
  ok: true;
  supplier: {
    domain: string;
    persona: Persona;
    inferredFrom: string[];
  };
  candidates: Candidate[];
}

function isUSCA(reg?: string): boolean {
  if (!reg) return false;
  const s = reg.toLowerCase();
  return (
    s.includes('united states') ||
    s.includes('usa') ||
    s.includes('us') ||
    s.includes('canada') ||
    s.includes('ca') ||
    // city/state shorthands that often show up
    /\b(ny|sf|la|tx|il|nj|on|bc|qc|ab|mb)\b/.test(s)
  );
}

// Very light domain -> persona inference so users see something coherent immediately.
function inferPersona(domain: string): { persona: Persona; clues: string[] } {
  const d = domain.toLowerCase();
  const clues: string[] = [];

  let persona: Persona = {
    productOffer: 'protective & shipping packaging',
    solves: 'reduce damage in transit and speed outbound ops',
    buyerTitles: ['Operations Manager', 'Procurement Manager', 'COO'],
  };

  if (d.includes('stretch') || d.includes('shrink')) {
    persona = {
      productOffer: 'palletizing & protective stretch/shrink film',
      solves: 'secure pallets, reduce load shift, cut film waste',
      buyerTitles: ['Warehouse Manager', 'Logistics Manager', 'COO'],
    };
    clues.push('domain suggests stretch/shrink film');
  } else if (d.includes('label')) {
    persona = {
      productOffer: 'product & shipping labels',
      solves: 'compliant labeling and faster pick/pack',
      buyerTitles: ['E-commerce Ops', 'Plant Manager', 'Procurement'],
    };
    clues.push('domain suggests labels');
  } else if (d.includes('mailer') || d.includes('poly')) {
    persona = {
      productOffer: 'poly mailers & e-com packaging',
      solves: 'lower DIM weight and protect parcels',
      buyerTitles: ['E-commerce Ops', 'Fulfillment Lead', 'Procurement'],
    };
    clues.push('domain suggests mailers');
  } else {
    clues.push('generic packaging supplier heuristics');
  }

  return { persona, clues };
}

// Tiny platform guesser (string heuristics only; safe for v0)
function guessPlatform(host: string): Candidate['platform'] {
  const h = host.toLowerCase();
  if (h.includes('myshopify') || h.includes('shopify')) return 'shopify';
  if (h.includes('woocommerce') || h.includes('wp') || h.includes('wordpress')) return 'woocommerce';
  if (h.includes('bigcommerce')) return 'bigcommerce';
  return 'unknown';
}

// Domain quality: .com/.ca and length heuristic only
function domainQuality(host: string): number {
  const h = host.toLowerCase();
  let s = 0.5;
  if (h.endsWith('.com') || h.endsWith('.ca')) s += 0.2;
  if (h.length >= 6 && h.length <= 22) s += 0.2;
  if (!/[^a-z0-9.-]/.test(h)) s += 0.1;
  return Math.min(1, Math.max(0, s));
}

// Build human-readable why chips
function buildWhyChips(persona: Persona, regions: string[] | undefined, host: string, intent: 'generic' | 'mailers' | 'labels' | 'palletizing'): WhyChip[] {
  const chips: WhyChip[] = [];

  // Persona fit (simple)
  chips.push({
    label: 'Persona fit',
    kind: 'persona',
    score: 0.7,
    detail: `${persona.productOffer} → ${persona.buyerTitles.join(', ')}`,
  });

  // Region bias to US/CA unless regions explicitly include others
  const regionList = (regions && regions.length ? regions : ['US', 'CA']).map(r => r.toString());
  const hasUSCA = regionList.some((r) => isUSCA(r));
  chips.push({
    label: 'Region match',
    kind: 'region',
    score: hasUSCA ? 0.9 : 0.5,
    detail: hasUSCA ? 'United States / Canada focus' : `Preferred regions: ${regionList.join(', ')}`,
  });

  // Domain quality
  chips.push({
    label: 'Domain quality',
    kind: 'meta',
    score: domainQuality(host),
    detail: `${host}`,
  });

  // Intent keyword (light)
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

// produce a couple of deterministic demo candidates using supplierDomain as salt
function demoCandidates(supplierDomain: string, persona: Persona, regions?: string[]): Candidate[] {
  // We keep these deterministic and simple so UX remains predictable while we wire real providers later.
  const seeds = [
    { host: 'brand-a.com', title: 'RFP: label refresh', intent: 'labels' as const },
    { host: 'brand-x.com', title: 'RFP: poly mailers',  intent: 'mailers' as const },
    { host: 'example.com', title: 'RFP: palletizing project', intent: 'palletizing' as const },
  ];

  // lightweight “temperature”: labels/mailers/palletizing map to hot; generic to warm
  return seeds.map((s, i) => ({
    id: String(100 + i),
    host: s.host,
    platform: guessPlatform(s.host),
    title: s.title,
    temperature: (s.intent === 'labels' || s.intent === 'mailers' || s.intent === 'palletizing') ? 'hot' : 'warm',
    why: buildWhyChips(persona, regions, s.host, s.intent),
  }));
}

function handleWebscout(req: Request, res: Response) {
  const body = (req.body || {}) as WebScoutRequest;
  const supplierDomain = String(body.supplierDomain || '').trim().toLowerCase();

  if (!supplierDomain) {
    return res.status(400).json({ ok: false, error: 'supplierDomain is required' });
  }

  // Infer persona purely from supplierDomain for v0
  const { persona, clues } = inferPersona(supplierDomain);

  const candidates = demoCandidates(supplierDomain, persona, body.regions);

  const payload: WebScoutResponse = {
    ok: true,
    supplier: {
      domain: supplierDomain,
      persona,
      inferredFrom: clues,
    },
    candidates,
  };

  return res.json(payload);
}

export default function mountWebscout(app: Express): void {
  const router = express.Router();

  // health for this module
  router.get('/webscout/ping', (_req, res) => res.json({ ok: true, pong: true, time: new Date().toISOString() }));

  // primary endpoint
  router.post('/webscout', handleWebscout);

  // alias used by panel code (so we don’t need to change index.ts): same handler
  router.post('/find', handleWebscout);

  app.use('/api/v1', router);
}
