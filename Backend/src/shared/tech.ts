// src/shared/tech.ts
//
// Artemis BV1 — ultra-fast tech detectors (no network, no deps).
// Feed this the HTML (and optional URL/headers) we already fetched in spider.ts.
// Returns:
//   - pixels: GA4 / GTM / UA (legacy) / Meta / TikTok / LinkedIn / Bing
//   - stack:  Shopify / BigCommerce / WooCommerce / WordPress / Wix / Squarespace
//   - pixelActivity: 0..1 (rough "ads readiness" intensity)
//   - reasons: short trace strings for debugging
//
// Pure and deterministic. Safe to run on every page we crawl.

export type Pixels = {
  ga4: boolean;        // gtag.js GA4
  gtm: boolean;        // Google Tag Manager
  ua: boolean;         // Legacy Universal Analytics
  meta: boolean;       // Meta Pixel (Facebook)
  tiktok: boolean;     // TikTok Pixel
  linkedin: boolean;   // LinkedIn Insight
  bing: boolean;       // Microsoft/Bing UET
};

export type Stack = {
  shopify: boolean;
  bigcommerce: boolean;
  woocommerce: boolean;
  wordpress: boolean;
  wix: boolean;
  squarespace: boolean;
};

export type TechSummary = {
  pixels: Pixels;
  stack: Stack;
  pixelActivity: number;   // 0..1
  reasons: string[];       // short match notes (cap ~24)
};

type HeaderMap = Record<string, string | string[] | undefined>;

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

const toStr = (v: unknown) => (v == null ? "" : String(v));
const lc = (s: string) => s.toLowerCase();

function getHeader(headers?: HeaderMap, name?: string): string {
  if (!headers || !name) return "";
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v.join(",") : toStr(v);
  }
  return "";
}

function has(re: RegExp, html: string, reasons: string[], note: string): boolean {
  if (re.test(html)) { reasons.push(note); return true; }
  return false;
}

function metaContent(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

function cap(arr: string[], n: number): string[] {
  if (arr.length > n) arr.length = n;
  return arr;
}

/* -------------------------------------------------------------------------- */
/* pixel detectors                                                            */
/* -------------------------------------------------------------------------- */

function detectPixels(htmlIn?: string): { pixels: Pixels; reasons: string[] } {
  const reasons: string[] = [];
  const html = lc(toStr(htmlIn));

  // GA4 (gtag.js) and GTM
  const ga4 =
    has(/googletagmanager\.com\/gtag\/js\?id=g-[a-z0-9]+/i, html, reasons, "ga4:script") ||
    has(/gtag\(\s*['"]config['"]\s*,\s*['"]g-[a-z0-9]+['"]\s*\)/i, html, reasons, "ga4:gtag-config");

  const gtm =
    has(/googletagmanager\.com\/gtm\.js/i, html, reasons, "gtm:script") ||
    has(/gtm-[a-z0-9]{4,}/i, html, reasons, "gtm:container");

  // Legacy UA
  const ua =
    has(/UA-\d{4,}-\d+/i, html, reasons, "ua:id") ||
    has(/google-analytics\.com\/analytics\.js/i, html, reasons, "ua:analytics.js") ||
    has(/ga\(\s*['"]create['"]/i, html, reasons, "ua:ga-create");

  // Meta Pixel
  const meta =
    has(/connect\.facebook\.net\/[^/]+\/fbevents\.js/i, html, reasons, "meta:fbevents") ||
    has(/\bfbevents\.init\b|\bfbq\(\s*['"]init['"]/i, html, reasons, "meta:fbq");

  // TikTok
  const tiktok =
    has(/analytics\.tiktok\.com\/i18n\/pixel\/events\.js/i, html, reasons, "ttq:script") ||
    has(/\bttq\.load\b|\bttq\.track\b/i, html, reasons, "ttq:fn");

  // LinkedIn
  const linkedin =
    has(/snap\.licdn\.com\/li\.lms-analytics\/insight\.min\.js/i, html, reasons, "li:insight.js") ||
    has(/_linkedin_partner_id\s*=/i, html, reasons, "li:partner-id");

  // Bing UET
  const bing =
    has(/bat\.bing\.com\/bat\.js/i, html, reasons, "bing:bat.js") ||
    has(/\buetq\s*=\s*uetq\s*\|\|\s*\[\]/i, html, reasons, "bing:uetq");

  const pixels: Pixels = { ga4, gtm, ua, meta, tiktok, linkedin, bing };
  return { pixels, reasons };
}

/* -------------------------------------------------------------------------- */
/* stack detectors                                                            */
/* -------------------------------------------------------------------------- */

function detectStack(htmlIn?: string, headersIn?: HeaderMap, urlIn?: string): { stack: Stack; reasons: string[] } {
  const reasons: string[] = [];
  const html = lc(toStr(htmlIn));
  const url = lc(toStr(urlIn));
  const headers = Object.fromEntries(Object.entries(headersIn || {}).map(([k, v]) => [k.toLowerCase(), toStr(v)])) as HeaderMap;

  // Shopify
  const shopify =
    has(/cdn\.shopify\.com/i, html, reasons, "shopify:cdn") ||
    has(/\bwindow\.shopify\b|\bshopify\.designmode\b/i, html, reasons, "shopify:window") ||
    getHeader(headers, "x-shopify-stage") !== "" ||
    /myshopify\.com|\/cart\.js|shopify-checkout|\.shopify\b/.test(html) ||
    /myshopify\.com/.test(url);

  if (shopify) reasons.push("shopify:match");

  // WooCommerce / WordPress
  const woocommerce =
    has(/wp-content\/plugins\/woocommerce/i, html, reasons, "woo:plugin") ||
    has(/\bwoocommerce\b/i, html, reasons, "woo:string");

  const wordpress =
    woocommerce ||
    has(/wp-content\/|wp-includes\//i, html, reasons, "wp:paths") ||
    /wordpress/i.test(metaContent(htmlIn || "", "generator"));

  if (wordpress) reasons.push("wp:match");

  // BigCommerce
  const bigcommerce =
    has(/cdn\.bigcommerce\.com/i, html, reasons, "bc:cdn") ||
    has(/\bbigcommerce\b/i, html, reasons, "bc:string") ||
    getHeader(headers, "x-bc-stencil-id") !== "";

  if (bigcommerce) reasons.push("bc:match");

  // Wix
  const wix =
    has(/static\.parastorage\.com|wixstatic\.com/i, html, reasons, "wix:assets") ||
    getHeader(headers, "x-wix-request-id") !== "" ||
    /wix\.com/.test(url);

  if (wix) reasons.push("wix:match");

  // Squarespace
  const squarespace =
    has(/static\.squarespace\.com/i, html, reasons, "sqsp:cdn") ||
    has(/\bsquarespace\b/i, html, reasons, "sqsp:string") ||
    /squarespace\.com/.test(url);

  if (squarespace) reasons.push("sqsp:match");

  const stack: Stack = { shopify: !!shopify, bigcommerce: !!bigcommerce, woocommerce: !!woocommerce, wordpress: !!wordpress, wix: !!wix, squarespace: !!squarespace };
  return { stack, reasons };
}

/* -------------------------------------------------------------------------- */
/* activity score                                                             */
/* -------------------------------------------------------------------------- */

// Collapse pixel booleans into a single 0..1 intensity. We treat "GA4 or GTM" as one bucket,
// then Meta, TikTok, LinkedIn, Bing as four more buckets. UA (legacy) gives a small extra.
function pixelActivityFrom(p: Pixels): number {
  const buckets =
    (p.ga4 || p.gtm ? 1 : 0) +
    (p.meta ? 1 : 0) +
    (p.tiktok ? 1 : 0) +
    (p.linkedin ? 1 : 0) +
    (p.bing ? 1 : 0) +
    (p.ua && !(p.ga4 || p.gtm) ? 0.5 : 0); // UA only is weaker
  const norm = Math.min(1, buckets / 3.5); // 3–4 active buckets ≈ 1.0
  return Number(norm.toFixed(3));
}

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Detect pixels & platform stack from a page.
 * @param html   full HTML string (raw). Safe to pass empty.
 * @param url    optional page URL (used for weak hints like *.myshopify.com).
 * @param headers optional response headers (case-insensitive object).
 */
export function detectTech(html?: string, url?: string, headers?: HeaderMap): TechSummary {
  const pixelRes = detectPixels(html);
  const stackRes = detectStack(html, headers, url);
  const reasons = cap([...pixelRes.reasons, ...stackRes.reasons], 24);
  const pixelActivity = pixelActivityFrom(pixelRes.pixels);
  return { pixels: pixelRes.pixels, stack: stackRes.stack, pixelActivity, reasons };
}

export default { detectTech, pixelActivityFrom };