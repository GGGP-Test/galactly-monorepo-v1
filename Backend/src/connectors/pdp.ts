// Backend/src/connectors/pdp.ts
// Lightweight PDP discovery: Shopify JSON → fallback to sitemap → fallback to common PDP paths.
// Emits concrete product URLs + short evidence snippet.

type PDP = { url: string; title?: string; snippet?: string; type: 'pdp'|'restock_post'|'new_sku'|'pdp_change' };

const FETCH_MS = Number(process.env.PDP_TIMEOUT_MS || 9000);

async function get(url: string): Promise<string|null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'GalactlyBot/0.1' } });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json') && !ct.includes('xml') && !ct.includes('html')) return null;
    return await r.text();
  } catch { return null; } finally { clearTimeout(t); }
}

function hostOf(d: string) { return d.replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase(); }
function h2t(html: string) { return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }

const CASE_RE = /\b(case|pack|ct)[ -]?(of)?[ -]?\d{1,3}\b/i;
const DIMS_RE = /\b\d{1,3}\s?[x×]\s?\d{1,3}\s?(x|×)\s?\d{1,3}\s?(in|inch|")\b/i;
const WT_RE = /\b\d+(\.\d+)?\s?(lb|oz|kg|g)\b/i;
const RESTOCK_RE = /\b(back\s?in\s?stock|restocked|available\s?again)\b/i;

function looksPackagingy(t: string) {
  const s = t.toLowerCase();
  return CASE_RE.test(s) || DIMS_RE.test(s) || WT_RE.test(s) || s.includes('carton') || s.includes('corrugated') || s.includes('box') || s.includes('case of');
}

async function shopifyProducts(host: string): Promise<PDP[]> {
  const urls = [
    `https://${host}/products.json?limit=50`,
    `https://${host}/collections/all?view=json`,
  ];
  const out: PDP[] = [];
  for (const u of urls) {
    const txt = await get(u);
    if (!txt) continue;
    // try JSON first
    try {
      const j = JSON.parse(txt);
      const products = j.products || j.items || [];
      for (const p of products) {
        const title = (p.title || p.name || '').toString();
        const h = `${title} ${p.body_html || p.description || ''}`;
        if (!looksPackagingy(h)) continue;
        const handle = p.handle || (p.url ? String(p.url).split('/').pop() : null);
        const url = p.handle ? `https://${host}/products/${handle}` : (p.url || null);
        if (url) out.push({ url, title, snippet: (h2t(h) || '').slice(0, 200), type: 'pdp' });
      }
      if (out.length) return out;
    } catch {
      // maybe HTML in “view=json”; treat like HTML list
      const text = h2t(txt).toLowerCase();
      // very rough split on "/products/"
      const m = txt.match(/href="\/products\/[^"]+/gi) || [];
      for (const a of m.slice(0, 30)) {
        const path = a.replace(/^href="/,'');
        const url = `https://${host}${path}`;
        const t = path.replace('/products/','').replace(/[-_]/g,' ');
        if (looksPackagingy(`${t} ${text.slice(0, 1000)}`)) out.push({ url, title: t, snippet: '', type: 'pdp' });
      }
      if (out.length) return out;
    }
  }
  return out;
}

async function sitemapProducts(host: string): Promise<PDP[]> {
  const txt = await get(`https://${host}/sitemap.xml`);
  if (!txt) return [];
  const links = Array.from(txt.matchAll(/<loc>(.*?)<\/loc>/g)).map(m => m[1]).filter(u => /\/products?\//i.test(u)).slice(0, 60);
  const out: PDP[] = [];
  for (const u of links) {
    const page = await get(u);
    if (!page) continue;
    const t = h2t(page);
    if (looksPackagingy(t)) out.push({ url: u, title: (t.slice(0, 80) || 'Product'), snippet: (t.slice(0, 240) || ''), type: RESTOCK_RE.test(t) ? 'restock_post' : 'pdp' });
    if (out.length >= 25) break;
  }
  return out;
}

async function genericPdp(host: string): Promise<PDP[]> {
  // Last resort: probe common catalog pages and lift a few product links
  const seeds = [
    `https://${host}/products/`,
    `https://${host}/collections/all`,
    `https://${host}/shop/`,
    `https://${host}/store/`,
  ];
  const out: PDP[] = [];
  for (const s of seeds) {
    const html = await get(s);
    if (!html) continue;
    const links = (html.match(/href="(\/products\/[^"]+)"/gi) || []).map(x => x.replace(/^href="/,'').replace(/"$/,''));
    for (const p of Array.from(new Set(links)).slice(0, 20)) {
      const u = `https://${host}${p}`;
      const page = await get(u);
      if (!page) continue;
      const t = h2t(page);
      if (looksPackagingy(t)) out.push({ url: u, title: (t.slice(0, 80)||'Product'), snippet: t.slice(0, 220), type: 'pdp' });
      if (out.length >= 20) break;
    }
    if (out.length) break;
  }
  return out;
}

export async function scanPDP(domain: string): Promise<PDP[]> {
  const host = hostOf(domain);
  if (!host.includes('.')) return [];
  // try Shopify, then sitemap, then generic
  const a = await shopifyProducts(host);
  if (a.length) return a.slice(0, Number(process.env.PDP_MAX || 25));
  const b = await sitemapProducts(host);
  if (b.length) return b.slice(0, Number(process.env.PDP_MAX || 25));
  const c = await genericPdp(host);
  return c.slice(0, Number(process.env.PDP_MAX || 25));
}
