import express, { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

// ---------------- Types ----------------
type Temp = 'hot' | 'warm';

interface WhyChip {
  label: string;              // e.g., "Geo"
  kind: 'meta' | 'platform' | 'signal' | 'context' | 'geo';
  score?: number;             // 0..1
  detail: string;             // human-readable evidence
}

export interface LeadRow {
  id: number;
  host: string;
  platform: string;
  title: string;
  created: number;
  temperature: Temp;
  why: WhyChip[];
}

interface FindBuyersBody {
  supplier: string;           // supplier domain
  region?: 'us' | 'ca' | 'us/ca';
  radiusMiles?: number;
  strict?: boolean;           // default true (US/CA only)
  keywords?: string;          // optional hints (ignored by default)
}

// ---------------- In-memory store ----------------
const leads: LeadRow[] = [];
let nextId = 1;

const router = express.Router();

// --------------- Helpers ----------------
function now() { return Date.now(); }

function normalizeHost(raw: string): string {
  let h = (raw || '').trim().toLowerCase();
  h = h.replace(/^https?:\/\//, '').replace(/\/.*$/, ''); // drop protocol & path
  return h;
}

function domainQualityScore(host: string): number {
  // Simple heuristic: .com/.net/.org/.ca/.us get small boost; short length boost
  let s = 0.5;
  if (host.endsWith('.com') || host.endsWith('.ca') || host.endsWith('.us')) s += 0.15;
  if (host.length <= 15) s += 0.10;
  if (host.includes('-') || host.length > 32) s -= 0.10;
  return clamp01(s);
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

function classifyTempFromText(text: string): Temp {
  const t = (text || '').toLowerCase();
  const hotKw = ['rfp', 'rfq', 'tender', 'bid', 'quote', 'request for quote', 'sourcing'];
  const isHot = hotKw.some(k => t.includes(k));
  return isHot ? 'hot' : 'warm';
}

function parseSeedsLine(line: string): { host: string, title?: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  // Accept either CSV "host,title" or plain host
  const parts = trimmed.split(',').map(s => s.trim());
  const host = normalizeHost(parts[0]);
  if (!host) return null;
  return { host, title: parts.slice(1).join(', ') || `Lead: ${host}` };
}

async function loadSeeds(): Promise<{ host: string, title: string }[]> {
  // Try a few locations. Fallback to empty if none found.
  const candidates: string[] = [
    '/etc/secrets/seeds.txt',
    '/etc/secrets/seed.txt',
    path.join(process.cwd(), 'seeds.txt'),
  ];
  for (const p of candidates) {
    try {
      const data = await fs.readFile(p, 'utf8');
      const rows = data.split(/\r?\n/).map(parseSeedsLine).filter(Boolean) as {host:string,title?:string}[];
      return rows.map(r => ({ host: r.host, title: r.title || `Lead: ${r.host}` }));
    } catch { /* ignore */ }
  }
  return [];
}

// --- Geo scoring (soft-in, hard-out) ---
type Region = 'us' | 'ca' | 'non-us/ca' | 'unknown';

function scoreGeo(host: string, snippet: string): { score: number, region: Region, evidence: string } {
  const h = host.toLowerCase();
  const t = (snippet || '').toLowerCase();

  // TLD signals
  if (h.endsWith('.ca')) return { score: 0.85, region: 'ca', evidence: '.ca domain' };
  if (h.endsWith('.us')) return { score: 0.80, region: 'us', evidence: '.us domain' };

  let score = 0.4; // base for .com/.net etc.
  let region: Region = 'unknown';
  const evidence: string[] = [];

  // Phone / address cues
  if (/\+1[\s\-.(]/.test(t)) { score += 0.15; evidence.push('+1 phone'); }
  if (/\b[A-Z]{2}\s?\d{5}\b/.test(snippet)) { score += 0.10; evidence.push('US ZIP pattern'); }
  if (/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i.test(snippet)) { score += 0.12; evidence.push('CA postal pattern'); }

  // Common US/CA city/state mentions (simple)
  const usStates = ['california','texas','new york','florida','illinois','ohio','pennsylvania','washington','new jersey','georgia'];
  const caProv = ['ontario','quebec','british columbia','alberta','manitoba','saskatchewan'];
  if (usStates.some(s => t.includes(s))) { score += 0.10; evidence.push('US city/state mention'); }
  if (caProv.some(s => t.includes(s))) { score += 0.10; evidence.push('CA province mention'); }

  // Non-US/CA ccTLD
  const ccTlds = ['.uk','.de','.fr','.ch','.au','.nz','.in','.ae','.cn','.jp','.mx','.br'];
  if (ccTlds.some(cc => h.endsWith(cc))) { score -= 0.50; evidence.push('non-US/CA ccTLD'); }

  score = clamp01(score);
  if (score >= 0.55) region = 'us';
  if (score >= 0.60 && evidence.some(e => /CA|province/i.test(e))) region = 'ca';
  if (score < 0.20 && ccTlds.some(cc => h.endsWith(cc))) region = 'non-us/ca';

  const evidenceText = evidence.length ? evidence.join(' • ') : 'Global .com, no address found';
  return { score, region, evidence: evidenceText };
}

// Build Why chips in plain English
function buildWhy(host: string, title: string, snippet: string): WhyChip[] {
  const dq = domainQualityScore(host);
  const geo = scoreGeo(host, snippet);
  const intentScore = /rfp|rfq|tender|quote|bid/i.test(title + ' ' + snippet) ? 0.9 : 0.6;

  return [
    { label: 'Domain quality', kind: 'meta', score: to2(dq), detail: host },
    { label: 'Geo', kind: 'geo', score: to2(geo.score), detail: geo.evidence },
    { label: 'Intent keywords', kind: 'signal', score: to2(intentScore), detail: intentScore > 0.8 ? 'rfp/rfq keywords found' : 'no strong keywords' },
    { label: 'Context', kind: 'context', detail: snippet.slice(0, 140) || '—' },
  ];
}

function to2(n?: number) { return n === undefined ? undefined : Math.round(n * 100) / 100; }

function makeLead(host: string, title: string, snippet: string): LeadRow {
  const why = buildWhy(host, title, snippet);
  const temp = classifyTempFromText(title + ' ' + snippet);
  return {
    id: nextId++,
    host,
    platform: 'unknown',
    title,
    created: now(),
    temperature: temp,
    why,
  };
}

// --------------- Routes ----------------

// Health for router
router.get('/ping', (_req, res) => res.json({ ok: true }));

// List leads (optionally filter by temp=hot|warm)
router.get('/', (req: Request, res: Response) => {
  const { temp } = req.query as { temp?: Temp };
  const rows = temp ? leads.filter(l => l.temperature === temp) : leads;
  rows.sort((a,b) => b.created - a.created); // newest first
  res.json({ ok: true, rows });
});

// Find buyers given supplier + region
router.post('/find-buyers', async (req: Request<{}, {}, FindBuyersBody>, res: Response) => {
  try {
    const supplier = normalizeHost(req.body?.supplier || '');
    if (!supplier) return res.status(400).json({ ok: false, error: 'missing supplier' });

    const strict = req.body.strict !== false; // default true (keep only US/CA)
    const region = (req.body.region || 'us/ca') as 'us'|'ca'|'us/ca';

    // persona inference (simple, extendable)
    const persona = personaFromSupplier(supplier);

    // Load seeds and synthesize basic snippet evidence
    const seeds = await loadSeeds();

    const createdIds: number[] = [];
    const candidates = seeds.map(({ host, title }) => {
      const snippet = makeSnippetFor(host, title, persona);
      const lead = makeLead(host, title, snippet);

      // Geo & region gate
      const geoChip = lead.why.find(w => w.kind === 'geo');
      const geoScore = geoChip?.score ?? 0;
      const regionLabel = geoRegionFromWhy(lead);
      const wanted = region === 'us/ca' ? (regionLabel === 'us' || regionLabel === 'ca') :
                     regionLabel === region;

      if (!strict || (geoScore >= 0.5 && wanted)) {
        leads.push(lead);
        createdIds.push(lead.id);
      }

      return {
        host: lead.host,
        title: lead.title,
        temperature: lead.temperature,
        why: lead.why,
      };
    });

    res.json({
      ok: true,
      supplierDomain: supplier,
      created: createdIds.length,
      ids: createdIds,
      candidates,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'internal error' });
  }
});

// Optional: lightweight single ingest (kept for compatibility)
router.post('/ingest', (req: Request, res: Response) => {
  const { host, title } = req.body || {};
  const h = normalizeHost(host || '');
  if (!h) return res.status(400).json({ ok: false, error: 'missing host' });
  const t = title || `Lead: ${h}`;
  const lead = makeLead(h, t, '');
  leads.push(lead);
  res.json({ ok: true, id: lead.id });
});

// --------------- Persona (very light heuristic) ---------------
function personaFromSupplier(host: string): { product: string, solves: string, titles: string[] } {
  const h = host.toLowerCase();
  if (h.includes('stretch') || h.includes('shrink')) {
    return { product: 'Stretch film & pallet protection', solves: 'Keeps pallets secure for storage & transit', titles: ['Warehouse Manager','Purchasing Manager','COO'] };
  }
  return { product: 'Packaging', solves: 'Protects products in shipping', titles: ['Operations Manager','Purchasing','Supply Chain'] };
}

function makeSnippetFor(host: string, title: string, persona: {product:string,solves:string,titles:string[]}): string {
  // A short evidence sentence that is human readable
  return `${title} — persona: ${persona.product}; solves: ${persona.solves}; roles: ${persona.titles.join(', ')}`;
}

function geoRegionFromWhy(lead: LeadRow): 'us'|'ca'|'unknown' {
  const w = lead.why.find(ch => ch.kind === 'geo');
  if (!w) return 'unknown';
  const det = w.detail.toLowerCase();
  if (det.includes('province') || det.includes('ca postal') || det.includes('.ca')) return 'ca';
  if (w.score !== undefined && w.score >= 0.5) return 'us';
  return 'unknown';
}

export default router;
