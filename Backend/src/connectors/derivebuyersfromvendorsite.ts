// Backend/src/connectors/derivebuyersfromvendorsite.ts
//
// Real-time heuristic extractor that visits a vendor's website,
// scans a handful of "about/customers/case-studies/industries" pages,
// and returns:
//   - candidate buyer domains (with proof URLs and a simple score)
//   - inferred industries/materials/tokens
//
// No external APIs. Safe for free Northflank.
//
// Usage:
//   import { deriveBuyersFromVendorSite } from './connectors/derivebuyersfromvendorsite';
//   const out = await deriveBuyersFromVendorSite('acme-packaging.com');
//   out.buyers -> [{ domain, proofUrl, title?, score }]
//
// Env (optional):
//   DERIVE_MAX_PAGES      default 8
//   DERIVE_TIMEOUT_MS     default 10000
//   DERIVE_BLOCK_HOSTS    comma list of host suffixes to ignore (e.g. "facebook.com,linkedin.com")
//   DERIVE_EXTRA_PATHS    comma list of extra root-relative paths to scan
//

type BuyerHit = {
  domain: string;
  proofUrl: string;
  title?: string | null;
  score: number;
};

type DeriveResult = {
  ok: true;
  vendor: string;
  checked: number;
  buyers: BuyerHit[];
  industries: string[];
  materials: string[];
  tokens: string[];
  hints: string[]; // human-readable
};

const DEFAULT_PATHS = [
  '/', '/about', '/about-us', '/who-we-are',
  '/industries', '/industry', '/markets', '/sectors', '/applications', '/solutions',
  '/customers', '/clients', '/client-list', '/brands', '/partners',
  '/case-studies', '/case-study', '/work', '/portfolio', '/projects',
  '/resources', '/news', '/blog'
];

const BAD_HOSTS_DEFAULT = [
  'facebook.com','instagram.com','linkedin.com','x.com','twitter.com','youtube.com','tiktok.com',
  'google.com','gstatic.com','google-analytics.com','googletagmanager.com',
  'cloudflare.com','cloudfront.net','akamaihd.net','jsdelivr.net','unpkg.com',
  'fonts.googleapis.com','fonts.gstatic.com','gravatar.com',
  'shopify.com','myshopify.com','bigcommerce.com','wix.com','squarespace.com',
  'cdn.shopify.com','cdn.shopifycdn.net'
];

const MATERIAL_TOKENS = [
  'corrugated','rsc','double wall','b-flute','c-flute','folding carton','rigid box',
  'poly mailer','mailer','pouch','stand-up pouch','label','labels',
  'shrink sleeve','flexible film','mylar','foil','tube','jar','bottle',
  'carton','case pack','master case','shipper','insert','void fill','clamshell'
];

const INDUSTRY_TOKENS = [
  'food','beverage','drink','cpg','cosmetics','beauty','skincare','personal care',
  'supplement','vitamin','nutraceutical','confectionery','candy','gummy','gummies',
  'pet','pet care','pharma','medical','cannabis','hemp','cbd','coffee','tea',
  'alcohol','beer','wine','spirits','bakery','frozen','dairy','cleaning','household'
];

const INTENT_TOKENS = [
  'our customers','our clients','brands we work with','trusted by','featured with',
  'case study','case studies','success story','portfolio','work with',
  'industries','markets we serve','sectors','applications','solutions'
];

function normDomain(input: string): string {
  const s = (input || '').trim().toLowerCase();
  return s.replace(/^https?:\/\//,'').replace(/\/+$/,'');
}

function toAbsUrl(base: string, href: string): string | null {
  try {
    const abs = new URL(href, `https://${base}`);
    return abs.href;
  } catch { return null; }
}

function isLikelyHtmlContent(ct?: string | null): boolean {
  const c = (ct || '').toLowerCase();
  return c.includes('text/html');
}

function titleFromHtml(html: string): string | null {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return m?.[1]?.trim() || null;
}

function extractAnchors(html: string): { href: string; text: string; near: string }[] {
  // crude but fast: find <a ... href="...">text</a>
  const out: { href:string; text:string; near:string }[] = [];
  const re = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    const inner = m[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    // Context window (simple): 120 chars around anchor in raw html
    const pos = Math.max(0, m.index - 120);
    const near = html.slice(pos, m.index + Math.min(300, m[0].length + 120)).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    out.push({ href, text: inner, near });
  }
  return out;
}

function extractTokens(html: string, dict: string[]): string[] {
  const text = html.replace(/<[^>]+>/g,' ').toLowerCase();
  const hits = new Set<string>();
  for (const t of dict) if (text.includes(t.toLowerCase())) hits.add(t);
  return Array.from(hits);
}

function hostFromUrl(u: string): string {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}

function isBlockedHost(h: string, blocklist: string[]): boolean {
  if (!h) return true;
  return blocklist.some(b => h === b || h.endsWith(`.${b}`));
}

function scoreExternalAnchor(anchor: {href:string;text:string;near:string}, host: string, pagePath: string): number {
  // Base score for being external brand-ish:
  let s = 0;

  const near = `${anchor.text} ${anchor.near}`.toLowerCase();
  const pageCtx = pagePath.toLowerCase();

  // discourage obvious non-brand links
  if (!host || host.includes('mailto:') || host.includes('tel:')) return -10;
  if (/\.(png|jpe?g|webp|gif|svg|pdf|css|js)(\?|$)/i.test(anchor.href)) s -= 2;

  // higher score on "clients/customers/case-studies"
  if (/(customers?|clients?|case-studies?|portfolio|work|brands?)/.test(pageCtx)) s += 2;

  // signals in the text/nearby
  if (/(client|customer|brand|case study|success|trusted|worked with)/.test(near)) s += 2;
  if (/(shop|buy|store|retailer|product)/.test(near)) s += 1;

  // de-score if it looks like social/platform/tool
  if (/(linkedin|facebook|instagram|x\.com|twitter|youtube|tiktok|google|adobe|figma|notion|slack|hubspot|mailchimp|salesforce)/.test(host)) s -= 3;

  // slight boost if anchor text is company-ish (1–2 words capitalized)
  if (/^[A-Z][A-Za-z0-9&\- ]{2,40}$/.test(anchor.text)) s += 1;

  // clamp
  return Math.max(-10, Math.min(10, s));
}

async function fetchHtml(u: string, timeoutMs: number): Promise<{ ok: boolean; html?: string; ct?: string; status?: number; }> {
  try {
    const ctl = new AbortController();
    const id = setTimeout(()=>ctl.abort(), timeoutMs);
    const r = await fetch(u, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'GalactlyBot/0.2 (+https://galactly.dev)' } });
    clearTimeout(id);
    if (!r.ok) return { ok:false, status:r.status };
    const ct = r.headers.get('content-type') || '';
    if (!isLikelyHtmlContent(ct)) return { ok:false, status:r.status, ct };
    const html = await r.text();
    // cap to 400kb
    return { ok:true, ct, html: html.slice(0, 400_000) };
  } catch {
    return { ok:false };
  }
}

export async function deriveBuyersFromVendorSite(vendorDomainRaw: string): Promise<DeriveResult> {
  const vendor = normDomain(vendorDomainRaw);
  const base = `https://${vendor}`;
  const MAX = Math.max(3, Number(process.env.DERIVE_MAX_PAGES || 8));
  const TIMEOUT = Math.max(3000, Number(process.env.DERIVE_TIMEOUT_MS || 10000));

  const extraPaths = (process.env.DERIVE_EXTRA_PATHS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => p.startsWith('/') ? p : `/${p}`);

  const blockHosts = [
    ...BAD_HOSTS_DEFAULT,
    ...(process.env.DERIVE_BLOCK_HOSTS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  ];

  const paths = Array.from(new Set([...DEFAULT_PATHS, ...extraPaths])).slice(0, 24);

  const buyers = new Map<string, BuyerHit>(); // domain -> hit
  const industriesHit = new Set<string>();
  const materialsHit = new Set<string>();
  const tokensHit = new Set<string>();
  const hints: string[] = [];

  let checked = 0;

  for (const p of paths) {
    if (checked >= MAX) break;
    const url = `${base}${p}`;
    const got = await fetchHtml(url, TIMEOUT);
    if (!got.ok || !got.html) continue;
    checked++;

    const html = got.html;
    const title = titleFromHtml(html);

    // Collect industry/material/tokens
    extractTokens(html, INDUSTRY_TOKENS).forEach(t => industriesHit.add(t));
    extractTokens(html, MATERIAL_TOKENS).forEach(t => materialsHit.add(t));
    extractTokens(html, INTENT_TOKENS).forEach(t => tokensHit.add(t));

    // External anchors
    const anchors = extractAnchors(html);
    for (const a of anchors) {
      const abs = toAbsUrl(vendor, a.href);
      if (!abs) continue;
      const h = hostFromUrl(abs);
      if (!h) continue;

      // skip same host
      if (h === vendor || h.endsWith(`.${vendor}`)) continue;
      if (isBlockedHost(h, blockHosts)) continue;

      let s = scoreExternalAnchor(a, h, p);
      if (/^\/(customers?|clients?|case-studies?|work|portfolio|brands?)/.test(p)) s += 1; // small path bonus

      // keep only decent candidates
      if (s >= 2) {
        const dom = h;
        // Prefer proof page to be this page if anchor is relative? we already have abs
        const proof = abs;
        const prev = buyers.get(dom);
        if (!prev || s > prev.score) {
          buyers.set(dom, { domain: dom, proofUrl: proof, title, score: s });
        }
      }
    }

    // Simple logo-based inference: look for alt="ClientName" near <img>
    // (This still resolves via <a> extraction because logos are usually wrapped in <a>)
  }

  // Rank by score (desc), then domain
  const buyerList = Array.from(buyers.values()).sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));

  // Add a few hints for UX/debug
  if (buyerList.length === 0) {
    hints.push('No external client/brand domains surfaced from visible anchor links. Consider adding vendor-provided "clients/brands" pages to DERIVE_EXTRA_PATHS.');
  } else {
    const top = buyerList.slice(0, 3).map(b => `${b.domain} (${b.score})`).join(', ');
    hints.push(`Top candidates: ${top}`);
  }
  if (industriesHit.size) hints.push(`Industries: ${Array.from(industriesHit).slice(0,6).join(', ')}`);
  if (materialsHit.size) hints.push(`Materials: ${Array.from(materialsHit).slice(0,6).join(', ')}`);

  return {
    ok: true,
    vendor,
    checked,
    buyers: buyerList,
    industries: Array.from(industriesHit),
    materials: Array.from(materialsHit),
    tokens: Array.from(tokensHit),
    hints
  };
}

// Tiny local test (uncomment to quick-run with tsx):
// (async () => {
//   const r = await deriveBuyersFromVendorSite('example.com');
//   console.log(r);
// })();
