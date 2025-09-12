// src/routes/webscout.ts
// Minimal WebScout v0 route (no external deps; compile-safe).
// Next step will be to mount it from src/index.ts (as a separate change).

// Import only TYPES to avoid esModuleInterop issues.
import type { Express, Request, Response } from 'express';

// ---- Types shared with the UI (keep tiny & stable) --------------------------

export type Temperature = 'hot' | 'warm' | 'cold' | 'unknown';

export interface WhySignal {
  label: string;              // short human label (e.g., "Domain quality")
  kind: 'meta' | 'platform' | 'signal' | 'packaging-math' | 'recent-activity';
  score: number;              // 0..1
  detail: string;             // human-readable
}

export interface LeadCandidate {
  cat: 'product' | 'service';
  platform: 'shopify' | 'woocommerce' | 'bigcommerce' | 'custom' | 'unknown';
  host: string;               // domain-only
  title: string;              // short title we display
  keywords?: string;
  temperature: Temperature;
  why: WhySignal[];
}

export interface WebscoutRequestBody {
  supplierDomain: string;     // e.g., "stretchandshrink.com"
  region?: string;            // optional preferred starting region/city
  personaHints?: string[];    // optional titles like "Purchasing Manager"
  verticals?: string[];       // optional sectors like "3PL", "Retail"
}

export interface WebscoutResponse {
  ok: true;
  supplierDomain: string;
  created: number;            // number of new leads created (v0 = 0)
  ids: string[];              // persisted ids (v0 = [])
  candidates: LeadCandidate[];// preview results (stubbed in v0)
}

export interface WebscoutError {
  ok: false;
  error: string;
}

// ---- Helpers ----------------------------------------------------------------

function onlyHost(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    // strip www.
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function platformGuess(host: string): LeadCandidate['platform'] {
  // v0: trivial guess by substrings; real version will probe & classify.
  if (host.includes('shop')) return 'shopify';
  if (host.includes('woo')) return 'woocommerce';
  return 'unknown';
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Very light scoring for the stub so UI can render "why" chips
function stubWhy(host: string): WhySignal[] {
  const domainQuality = host.endsWith('.com') ? 0.65 : 0.4;
  const intent = /rfp|rfq|pack|box|label|mailer/i.test(host) ? 0.8 : 0.5;
  return [
    { label: 'Domain quality', kind: 'meta',      score: clamp01(domainQuality), detail: `${host} (${host.split('.').pop()})` },
    { label: 'Platform fit',   kind: 'platform',  score: clamp01(platformGuess(host) === 'unknown' ? 0.5 : 0.75), detail: platformGuess(host) },
    { label: 'Intent keywords',kind: 'signal',    score: clamp01(intent), detail: 'stubbed: host heuristic' },
  ];
}

// ---- Route ------------------------------------------------------------------

export default function mountWebscout(app: Express) {
  // POST /api/v1/webscout — “Find buyers” (stub v0)
  app.post('/api/v1/webscout', async (req: Request, res: Response<WebscoutResponse | WebscoutError>) => {
    try {
      const body: WebscoutRequestBody = (req as any).body || {};
      const host = onlyHost(body.supplierDomain || '');
      if (!host) {
        return res.status(400).json({ ok: false, error: 'supplierDomain is required (domain or URL).' });
      }

      // v0 stub: fabricate 2 preview candidates derived from host.
      const base = host.split('.')[0] || 'brand';
      const candidates: LeadCandidate[] = [
        {
          cat: 'product',
          platform: platformGuess(host),
          host: `${base}-x.com`,
          title: 'RFQ: label refresh',
          keywords: 'labels, rfq',
          temperature: 'warm',
          why: stubWhy(`${base}-x.com`),
        },
        {
          cat: 'product',
          platform: platformGuess(host),
          host: `${base}-y.com`,
          title: 'RFP: poly mailers',
          keywords: 'mailers, packaging',
          temperature: 'warm',
          why: stubWhy(`${base}-y.com`),
        },
      ];

      const resp: WebscoutResponse = {
        ok: true,
        supplierDomain: host,
        created: 0,
        ids: [],
        candidates,
      };
      return res.status(200).json(resp);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'internal error' });
    }
  });

  // GET /api/v1/webscout/ping — quick smoke test
  app.get('/api/v1/webscout/ping', (_req: Request, res: Response) => {
    res.json({ ok: true, pong: true, t: new Date().toISOString() });
  });
}
