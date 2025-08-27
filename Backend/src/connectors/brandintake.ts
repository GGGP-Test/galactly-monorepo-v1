// Backend/src/connectors/brandintake.ts
// Passive crawler for buyer "supplier / vendor-intake" pages.
// - Reads BUYERS_FILE (one domain per line)
// - Probes common intake URLs
// - Heuristically scores pages for explicit sourcing intent
// - Upserts into lead_pool (platform='buyer-intake')

import fs from 'fs';
import path from 'path';
import { q } from '../db';

const USER_AGENT = 'GalactlyBot/0.1 (+contact: hello@galactly.example)';
const CONCURRENCY = Number(process.env.BRANDINTAKE_CONCURRENCY || 4);
const TIMEOUT_MS = Number(process.env.BRANDINTAKE_TIMEOUT_MS || 8000);

const SUPPLIER_TOKENS = [
  'become a supplier','supplier registration','vendor registration','supplier portal','vendor portal',
  'procurement','sourcing','rfi','rfq','request for quote','request for information',
  'purchase order','ap/ar vendor','new vendor form','vendor onboarding'
];

const PACKAGING_TOKENS = [
  'packaging','corrugated','carton','cartons','boxes','box','mailer','rsc','labels','label',
  'pouch','pouches','film','flexible','shrink','void fill','foam','inserts','rigid','folding carton'
];

function readLines(p: string): string[] {
  try {
    return fs.readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^https?:\/\//i, '').replace(/\/$/, ''));
  } catch {
    return [];
  }
}

function candidates(domain: string): string[] {
  const base = `https://${domain}`;
  const paths = [
    '/suppliers','/supplier','/vendor','/vendors','/partners','/partner',
    '/procurement','/sourcing','/supply-chain','/supplychain',
    '/rfq','/rfi','/tenders','/bid','/bids',
    '/legal/vendor','/accounting/vendor','/become-a-supplier','/become-a-vendor',
    '/contact-sourcing','/purchasing','/purchase'
  ];
  const urls = paths.map(p => base + p);
  // Also try a public portal subdomain guess
  urls.push(`https://supplier.${domain}`);
  urls.push(`https://vendors.${domain}`);
  return urls;
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text?: string; ct?: string }>{
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT }, signal: ctrl.signal });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/text\/html|application\/xhtml\+xml/i.test(ct)) return { ok: false, status: r.status, ct };
    const text = await r.text();
    return { ok: true, status: r.status, text, ct };
  } catch (e) {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(id);
  }
}

function scorePage(html: string): { score: number; reasons: string[] }{
  const h = html.toLowerCase();
  let score = 0; const reasons: string[] = [];
  for (const t of SUPPLIER_TOKENS) { if (h.includes(t)) { score += 1.5; reasons.push(`token:${t}`); } }
  for (const t of PACKAGING_TOKENS) { if (h.includes(t)) { score += 1.0; reasons.push(`pack:${t}`); } }
  // Simple form / select heuristics (signals explicit intake)
  const hasForm = /<form[\s>]/i.test(html);
  const hasSelect = /<select[\s\S]*?<\/select>/i.test(html);
  if (hasForm) { score += 1.0; reasons.push('form'); }
  if (hasSelect) { score += 0.5; reasons.push('select'); }
  // Recent date hint
  if (/(20\d{2})/i.test(html)) { score += 0.2; }
  return { score, reasons };
}

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Vendor portal').replace(/\s+/g, ' ').trim();
}

function snippetOf(html: string): string {
  // Prefer a heading or meta description
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return h1.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1];
  if (meta) return meta.trim().slice(0, 240);
  const txt = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
                  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return txt.slice(0, 240);
}

async function upsertLead(url: string, title: string, snippet: string, heat: number, kw: string[]) {
  // cat = 'buyer-intake', platform='buyer-intake'
  await q(
    `INSERT INTO lead_pool(cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state)
     VALUES ($1,$2,'buyer-intake',$3,$4,$5,$6,$7, now() + interval '7 days','available')
     ON CONFLICT (source_url) DO NOTHING`,
    ['buyer-intake', kw, 70, heat, url, title, snippet]
  );
}

async function worker(domain: string): Promise<number> {
  let inserted = 0;
  const urls = candidates(domain);
  for (const u of urls) {
    const r = await fetchText(u);
    if (!r.ok || !r.text) continue;
    const { score, reasons } = scorePage(r.text);
    // Require a minimal threshold: explicit supplier + packaging words
    const hasSupplier = SUPPLIER_TOKENS.some(t => r.text!.toLowerCase().includes(t));
    const hasPack = PACKAGING_TOKENS.some(t => r.text!.toLowerCase().includes(t));
    if (!hasSupplier) continue;
    const heat = Math.round(Math.min(100, Math.max(40, score * 12)));
    const title = titleOf(r.text);
    const snippet = snippetOf(r.text);
    await upsertLead(u, title, snippet + ` — [${reasons.slice(0,6).join(', ')}]`, heat, ['buyer','intake','packaging']);
    inserted++;
    // One good hit per domain is enough for now
    break;
  }
  return inserted;
}

async function runPool<T>(items: T[], fn: (x: T) => Promise<number>, conc = CONCURRENCY): Promise<number> {
  let i = 0, total = 0; const active: Promise<void>[] = [];
  async function next(){
    const x = items[i++]; if (x === undefined) return;
    const p = fn(x).then(n => { total += n; }).catch(()=>{}).finally(()=>{});
    active.push(p.then(()=>{ active.splice(active.indexOf(p as any),1); }));
    if (active.length >= conc) await Promise.race(active);
    await next();
  }
  await next(); await Promise.all(active); return total;
}

export async function runBrandIntakeFromFile(filePath?: string){
  const p = filePath || process.env.BUYERS_FILE || '/etc/secrets/buyers.txt';
  const buyers = readLines(p);
  if (!buyers.length) return { ok: false as const, error: `no buyers in ${p}` };
  const inserted = await runPool(buyers, worker, CONCURRENCY);
  return { ok: true as const, inserted, total: buyers.length };
}

// Convenience entry for ingest.ts
export async function runBrandIntake(){
  return runBrandIntakeFromFile();
}
