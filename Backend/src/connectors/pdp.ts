// Backend/src/connectors/pdp.ts
// Lightweight PDP/retail signal collector (Shopify-first, generic fallback)
// Inserts directly into lead_pool (UNIQUE on source_url prevents dupes)

import { q } from "../db";

const UA = process.env.BRANDINTAKE_USERAGENT ||
  "GalactlyBot/0.1 (+https://trygalactly.com)";

// Limits (env‑tunable)
const PDP_MAX_PAGES = Number(process.env.PDP_MAX_PAGES || 12); // per domain
const PDP_TIMEOUT_MS = Number(process.env.PDP_TIMEOUT_MS || 10000);

// --- helpers ---
function normDomain(d: string) {
  return d.replace(/^https?:\/\//, "").replace(/\/+.*/, "").toLowerCase();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), PDP_TIMEOUT_MS);
    const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html")) return null;
    const html = await r.text();
    return html.slice(0, 400_000);
  } catch { return null; }
}

async function fetchJson<T=any>(url: string): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), PDP_TIMEOUT_MS);
    const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("json")) return null;
    return await r.json();
  } catch { return null; }
}

function pickTitle(html: string) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || "Product").trim().replace(/\s+/g, " ").slice(0, 140);
}

function toKw(arr: string[]): string[] {
  return Array.from(new Set(arr.map(s => s.toLowerCase()))).slice(0, 8);
}

function looksLikeShopifyRoot(html: string) {
  return /shopify|cdn\.shopify\.com|\/collections\//i.test(html);
}

// Extract quick PDP signals from HTML text
function htmlSignals(url: string, html: string) {
  const sigs: {kw: string[]; why: string; heat: number; title: string; snippet: string}[] = [];
  const lower = html.toLowerCase();
  const title = pickTitle(html);

  // Patterns
  const caseM = html.match(/case\s+of\s+(\d{1,4})/i);
  const backInStock = /back\s*in\s*stock/i.test(html);
  const newSku = /new\s+(sku|flavor|product|variant)/i.test(html);
  const dims = html.match(/(\d{1,3}(?:\.\d+)?)\s*(?:x|×)\s*(\d{1,3}(?:\.\d+)?)\s*(?:x|×)\s*(\d{1,3}(?:\.\d+)?)(?:\s*(?:in|inch|\"))?/i);

  const pieces: string[] = [];
  if (caseM) pieces.push(`case of ${caseM[1]}`);
  if (dims) pieces.push(`dims ${dims[0].replace(/\s+/g,' ')}`);
  if (backInStock) pieces.push("back in stock");
  if (newSku) pieces.push("new sku");

  if (pieces.length) {
    const why = pieces.join(" · ");
    const kw = toKw(["pdp", "retail", "case", caseM?.[1] || "", backInStock?"restock":"", newSku?"new":"", dims?"dims":""]);
    // crude heat: more signals => hotter
    const heat = Math.min(95, 60 + pieces.length * 8);
    const snippet = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 260);
    sigs.push({ kw, why, heat, title, snippet });
  }

  // Also look for wholesale/pack terms even without explicit case-of
  if (/carton|master\s*case|shipper|12[-\s]*pk|24[-\s]*pk|unit\s*weight|case\s*pack/i.test(lower)) {
    const why = "carton/case-pack hints";
    const kw = toKw(["pdp","retail","case-pack","carton"]);
    const snippet = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 240);
    sigs.push({ kw, why, heat: 72, title, snippet });
  }

  return sigs.map(s => ({ ...s, url }));
}

// Shopify: /products.json (public) — many shops keep this open
async function scanShopify(domain: string) {
  const base = `https://${domain}`;
  const out: { url: string; title: string; snippet: string; kw: string[]; heat: number }[] = [];

  // Try products endpoint (limit few pages to stay light)
  const perPage = 50;
  for (let page = 1; page <= 2; page++) {
    const api = `${base}/products.json?limit=${perPage}&page=${page}`;
    const data = await fetchJson<any>(api);
    if (!data || !Array.isArray(data.products) || !data.products.length) break;

    for (const p of data.products.slice(0, PDP_MAX_PAGES)) {
      const pUrl = `${base}/products/${p.handle || encodeURIComponent(String(p.id))}`;
      const title = String(p.title || "Product");
      const body = String(p.body_html || "");
      const variants = Array.isArray(p.variants) ? p.variants : [];
      const anyAvail = variants.some((v: any) => v?.available === true);

      // signals from structured fields + body text
      const htmlSig = htmlSignals(pUrl, `<title>${title}</title> ${body}`);
      const kw = new Set<string>(["pdp","shopify"]);
      if (anyAvail) kw.add("in-stock");
      if (htmlSig.length) htmlSig[0].kw.forEach(k => kw.add(k));

      const snippet = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 260);
      const heat = Math.min(92, 65 + (anyAvail ? 6 : 0) + (htmlSig.length ? 6 : 0));
      out.push({ url: pUrl, title, snippet, kw: Array.from(kw), heat });
    }
  }

  // Fallback: collections/all page
  const allHtml = await fetchText(`${base}/collections/all`);
  if (allHtml) {
    const sigs = htmlSignals(`${base}/collections/all`, allHtml);
    for (const s of sigs) out.push({ url: s.url, title: s.title, snippet: s.snippet, kw: s.kw, heat: s.heat });
  }

  return out;
}

// Generic scan few obvious pages
async function scanGeneric(domain: string) {
  const base = `https://${domain}`;
  const paths = ["/", "/shop", "/products", "/collections/all", "/store"];
  const out: { url: string; title: string; snippet: string; kw: string[]; heat: number }[] = [];
  for (const p of paths.slice(0, PDP_MAX_PAGES)) {
    const html = await fetchText(base + p);
    if (!html) continue;
    const sigs = htmlSignals(base + p, html);
    for (const s of sigs) out.push({ url: s.url, title: s.title, snippet: s.snippet, kw: s.kw, heat: s.heat });
  }
  return out;
}

export async function scanPdpForDomain(domainInput: string) {
  const domain = normDomain(domainInput);
  const base = `https://${domain}`;
  let created = 0, checked = 0;
  const proofs: any[] = [];

  // Quick root sniff
  const root = await fetchText(base);
  checked++;
  let leads: { url: string; title: string; snippet: string; kw: string[]; heat: number }[] = [];
  if (root && looksLikeShopifyRoot(root)) {
    leads = await scanShopify(domain);
  } else {
    // still try Shopify JSON once (some themes hide hints)
    const sj = await fetchJson<any>(`${base}/products.json?limit=1`);
    if (sj && Array.isArray(sj.products)) leads = await scanShopify(domain);
    else leads = await scanGeneric(domain);
  }

  for (const L of leads.slice(0, PDP_MAX_PAGES)) {
    try {
      await q(
        `INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet, ttl, state)
         VALUES ('retail', $1::text[], 'pdp', $2, $3, $4, $5, now() + interval '6 hours', 'available')
         ON CONFLICT (source_url) DO NOTHING`,
        [L.kw, L.heat, L.url, L.title, L.snippet]
      );
      created++;
      proofs.push({ url: L.url, why: L.kw, heat: L.heat });
    } catch {
      // ignore insert errors (uniq conflicts etc.)
    }
  }

  return { ok: true, created, checked, proofs } as const;
}

// Convenience for an array of domains
export async function scanPdpMany(domains: string[]) {
  let created = 0, checked = 0; const allProofs: any[] = [];
  for (const d of domains) {
    const r = await scanPdpForDomain(d);
    created += r.created; checked += r.checked; allProofs.push(...r.proofs);
  }
  return { ok: true, created, checked, proofs: allProofs } as const;
}
