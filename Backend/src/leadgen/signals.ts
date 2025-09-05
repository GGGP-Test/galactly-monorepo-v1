// src/leadgen/signals.ts
/**
 * signals.ts — pluggable lead signals and scoring
 *
 * Produces a bundle of signal results (0..1) with evidence, plus an overall intent score.
 * All providers are pure/async and safe to run in parallel with timeouts.
 */

export type Millis = number;

export interface CacheLike {
  get(key: string): Promise<any> | any;
  set(key: string, val: any, ttlMs?: Millis): Promise<void> | void;
}

export interface SignalContext {
  domain: string;
  url?: string;
  html?: string;            // main page HTML if available
  text?: string;            // extracted text (optional)
  fetch?: typeof fetch;     // overrideable for SSR/tests
  headers?: Record<string, string>;
  cache?: CacheLike;
  now?: () => number;
  timeoutMs?: Millis;       // per-signal timeout
  userAgent?: string;
  // additional metadata (e.g., from earlier stages)
  meta?: Record<string, any>;
}

export interface SignalEvidence {
  id: string;               // stable id for this piece of evidence
  value: number;            // 0..1 contribution
  label: string;            // human-readable
  source?: string;          // url or origin
  meta?: Record<string, any>;
}

export interface SignalResult {
  id: string;               // provider id
  score: number;            // 0..1 normalized
  weight: number;           // relative importance in overall
  evidences: SignalEvidence[];
  updatedAt: string;        // ISO
  error?: string;
}

export interface SignalProvider {
  id: string;
  description?: string;
  weight?: number; // default 1
  run(ctx: SignalContext): Promise<SignalResult>;
}

export interface BundleResult {
  byId: Record<string, SignalResult>;
  results: SignalResult[];
  overall: number;          // weighted average of scores
  updatedAt: string;        // ISO
}

const DEFAULT_TIMEOUT = 4500;

function withTimeout<T>(p: Promise<T>, ms: number, tag = "signal"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${tag}:${ms}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function nowISO() { return new Date().toISOString(); }

function sum(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }
function clamp01(x: number) { return Math.min(1, Math.max(0, x)); }

export class SignalRunner {
  constructor(private providers: SignalProvider[]) {}

  list(): string[] { return this.providers.map(p => p.id); }

  async runAll(ctx: SignalContext): Promise<BundleResult> {
    const tasks = this.providers.map(p => this.runOne(p, ctx));
    const results = await Promise.all(tasks);
    const weights = results.map(r => r.weight);
    const weighted = sum(results.map((r, i) => r.score * (weights[i] || 1)));
    const denom = sum(weights) || 1;
    const overall = clamp01(weighted / denom);
    const byId: Record<string, SignalResult> = {};
    for (const r of results) byId[r.id] = r;
    return { byId, results, overall, updatedAt: nowISO() };
  }

  private async runOne(p: SignalProvider, ctx: SignalContext): Promise<SignalResult> {
    const timeout = ctx.timeoutMs ?? DEFAULT_TIMEOUT;
    const weight = p.weight ?? 1;
    try {
      const res = await withTimeout(p.run(ctx), timeout, p.id);
      return { ...res, weight, updatedAt: res.updatedAt || nowISO() };
    } catch (e: any) {
      return {
        id: p.id,
        score: 0,
        weight,
        evidences: [],
        updatedAt: nowISO(),
        error: String(e?.message || e),
      };
    }
  }
}

// --------------------- Built-in providers -------------------------

/**
 * Detects commerce stack, pixels, and checkout signals
 * Infers buying activity/readiness by presence of cart/checkout, analytics, and promo cadence.
 */
export class CommerceSignal implements SignalProvider {
  id = "commerce";
  description = "Commerce stack & transactional readiness";
  weight = 1.2;

  async run(ctx: SignalContext): Promise<SignalResult> {
    const html = ctx.html || "";
    const evidences: SignalEvidence[] = [];

    const hasCart = /cart|checkout|add[-\s]?to[-\s]?cart/i.test(html);
    const hasShopify = /cdn\.shopify\.com|x-shopify/i.test(html);
    const hasWoo = /woocommerce|wp-content\/plugins\/woocommerce/i.test(html);
    const hasMagento = /mage\/cookies|Magento_/i.test(html);
    const hasGA4 = /gtag\('config','G-[A-Z0-9]+'\)|googletagmanager\.com\/gtm\.js/i.test(html);
    const hasMetaPixel = /connect\.facebook\.net\/.+?fbevents\.js|fbq\('init'/i.test(html);
    const hasPromo = /(sale|subscribe|bundle|free shipping|limited time)/i.test(html);

    if (hasCart) evidences.push(ev("cart", 0.25, "Cart/Checkout elements detected"));
    if (hasShopify) evidences.push(ev("shopify", 0.25, "Shopify signal"));
    if (hasWoo) evidences.push(ev("woo", 0.18, "WooCommerce signal"));
    if (hasMagento) evidences.push(ev("magento", 0.2, "Magento signal"));
    if (hasGA4) evidences.push(ev("ga4", 0.1, "Google Analytics configured"));
    if (hasMetaPixel) evidences.push(ev("meta-pixel", 0.1, "Meta Pixel configured"));
    if (hasPromo) evidences.push(ev("promo", 0.08, "Promo/offer language"));

    // Normalize score: sum of top few with cap.
    const score = clamp01(sum(evidences.map(e => e.value)));
    return {
      id: this.id,
      score,
      weight: this.weight!,
      evidences,
      updatedAt: nowISO(),
    };
  }
}

/** Indicates B2B readiness: RFQ/wholesale forms, MOQ language, case packs, distributor pages */
export class B2BIntentSignal implements SignalProvider {
  id = "b2b_intent";
  description = "B2B readiness (RFQ/wholesale)";
  weight = 1.3;

  async run(ctx: SignalContext): Promise<SignalResult> {
    const html = (ctx.html || "") + " " + (ctx.text || "");
    const evidences: SignalEvidence[] = [];
    const patterns = [
      ["rfq", /(request a quote|rfq|quote request|get a quote)/i, 0.35],
      ["wholesale", /(wholesale|bulk pricing|distributor)/i, 0.3],
      ["moq", /\bmoq\b|minimum order/i, 0.2],
      ["casepack", /(case pack|master case|carton qty)/i, 0.15],
      ["specsheet", /(datasheet|spec(ification)?s?|material safety data)/i, 0.1],
    ] as const;

    for (const [id, re, v] of patterns) if (re.test(html)) evidences.push(ev(id, v, `Detected ${id}`));

    // small bonus for multiple indicators
    const multi = evidences.length >= 3 ? 0.1 : evidences.length === 2 ? 0.05 : 0;
    if (multi) evidences.push(ev("multi", multi, "Multiple B2B intent indicators"));

    return {
      id: this.id,
      score: clamp01(sum(evidences.map(x => x.value))),
      weight: this.weight!,
      evidences,
      updatedAt: nowISO(),
    };
  }
}

/** Scrapes lightweight "hiring" signals by peeking at /careers or /jobs. */
export class HiringMomentumSignal implements SignalProvider {
  id = "hiring";
  description = "Hiring momentum (proxy for growth)";
  weight = 0.8;

  async run(ctx: SignalContext): Promise<SignalResult> {
    const fetcher = ctx.fetch || fetch;
    const ua = ctx.userAgent || "LeadAI/1.0";
    const base = ctx.url || `https://${ctx.domain}`;
    const evidences: SignalEvidence[] = [];

    const endpoints = ["/careers", "/jobs", "/careers.html", "/about#careers"];
    let hitCount = 0;
    for (const p of endpoints) {
      try {
        const url = new URL(p, base).toString();
        const html = await withTimeout(fetcher(url, { headers: { "User-Agent": ua, "Accept": "text/html" } }).then(r => r.ok ? r.text() : ""), 2000, "hiring:fetch");
        if (html) {
          const sign = /(we'?re\s+hiring|open positions|join our team|apply now|job openings)/i.test(html);
          if (sign) {
            hitCount++;
            evidences.push(ev(`page:${p}`, 0.25, `Hiring page signals on ${p}`, url));
          }
        }
      } catch { /* ignore */ }
    }

    const mainHtml = ctx.html || "";
    if (/(hiring|open roles|careers)/i.test(mainHtml)) {
      evidences.push(ev("mainpage", 0.15, "Hiring references on homepage"));
    }

    const score = clamp01(hitCount * 0.25 + (/(engineer|operator|production)/i.test(mainHtml) ? 0.1 : 0));
    if (score > 0 && evidences.length === 0) evidences.push(ev("inferred", score, "Hiring inferred from content"));

    return { id: this.id, score, weight: this.weight!, evidences, updatedAt: nowISO() };
  }
}

/** Social proof via reviews widgets/providers */
export class ReviewsSignal implements SignalProvider {
  id = "reviews";
  description = "Reviews presence & velocity proxies";
  weight = 0.7;

  async run(ctx: SignalContext): Promise<SignalResult> {
    const html = ctx.html || "";
    const evs: SignalEvidence[] = [];
    const providers = [
      ["trustpilot", /trustpilot\.com|TrustpilotWidget/i, 0.25],
      ["yotpo", /yotpo\.com|staticw2\.yotpo/i, 0.2],
      ["stamped", /stamped\.io/i, 0.18],
      ["okendo", /okendo\.io/i, 0.18],
      ["judgeme", /judge\.me/i, 0.15],
      ["google", /(aggregateRating|ld\+json".*?ratingValue)/i, 0.12],
    ] as const;

    for (const [id, re, val] of providers) if (re.test(html)) evs.push(ev(id, val, `${id} reviews widget`));

    // Look for "X reviews" snippets
    const m = html.match(/(\d{2,5})\s+reviews/i);
    if (m) {
      const n = Number(m[1]);
      const v = n >= 1000 ? 0.3 : n >= 200 ? 0.2 : n >= 50 ? 0.1 : 0.05;
      evs.push(ev("count", v, `${n} reviews detected`));
    }

    const score = clamp01(sum(evs.map(e => e.value)));
    return { id: this.id, score, weight: this.weight!, evidences: evs, updatedAt: nowISO() };
  }
}

/** Logistics/ops signals hinting at packaging consumption (subscriptions, refill, bundles) */
export class OpsConsumptionSignal implements SignalProvider {
  id = "ops";
  description = "Ops/consumption proxies (subscriptions/refill/bundle)";
  weight = 1.0;

  async run(ctx: SignalContext): Promise<SignalResult> {
    const html = (ctx.html || "") + " " + (ctx.text || "");
    const evs: SignalEvidence[] = [];
    const subs = /(subscribe\s*&\s*save|auto[-\s]?ship|refill|subscription)/i.test(html);
    const bundles = /(bundle|case|carton|pack of \d+)/i.test(html);
    const wholesalePortal = /(B2B portal|net terms|purchase order|PO number)/i.test(html);

    if (subs) evs.push(ev("subscription", 0.35, "Subscription/refill language"));
    if (bundles) evs.push(ev("bundle", 0.2, "Bundle/case-pack language"));
    if (wholesalePortal) evs.push(ev("b2b-portal", 0.25, "B2B purchasing language"));

    // small boost if commerce signals exist in meta
    if (ctx.meta?.commerceScore && ctx.meta.commerceScore > 0.6) evs.push(ev("synergy", 0.1, "Synergy w/ commerce"));

    return { id: this.id, score: clamp01(sum(evs.map(e => e.value))), weight: this.weight!, evidences: evs, updatedAt: nowISO() };
  }
}

/** Marketing activity via pixels/ad scripts */
export class AdsSignal implements SignalProvider {
  id = "ads";
  description = "Active ads/pixels cadence";
  weight = 0.9;

  async run(ctx: SignalContext): Promise<SignalResult> {
    const html = ctx.html || "";
    const evs: SignalEvidence[] = [];
    const gads = /googletagmanager\.com|adsbygoogle|doubleclick\.net/i.test(html);
    const tiktok = /analytics\.tiktok\.com|tiktok\.js/i.test(html);
    const pinterest = /ct\.pinterest\.com|pintrk/i.test(html);
    const snap = /sc-static\.net|snap\.com\/sdk/i.test(html);
    const klaviyo = /klaviyo\.com\/client|_learnq/i.test(html);

    if (gads) evs.push(ev("google-ads", 0.22, "Google Ads/Tag Manager"));
    if (tiktok) evs.push(ev("tiktok-pixel", 0.2, "TikTok Pixel"));
    if (pinterest) evs.push(ev("pinterest", 0.12, "Pinterest Tag"));
    if (snap) evs.push(ev("snap", 0.08, "Snap Pixel"));
    if (klaviyo) evs.push(ev("klaviyo", 0.1, "Klaviyo marketing"));

    // heuristic: multiple pixels => active acquisition
    if (evs.length >= 3) evs.push(ev("multi-pixel", 0.15, "Multiple ad pixels present"));

    return { id: this.id, score: clamp01(sum(evs.map(e => e.value))), weight: this.weight!, evidences: evs, updatedAt: nowISO() };
  }
}

// ------------------- Registry & convenience ----------------------

export function defaultSignalProviders(): SignalProvider[] {
  return [
    new CommerceSignal(),
    new B2BIntentSignal(),
    new HiringMomentumSignal(),
    new ReviewsSignal(),
    new OpsConsumptionSignal(),
    new AdsSignal(),
  ];
}

export async function computeSignals(ctx: SignalContext, providers = defaultSignalProviders()): Promise<BundleResult> {
  const runner = new SignalRunner(providers);
  const bundle = await runner.runAll(ctx);
  // annotate synergy in meta: e.g., share commerce score
  const commerce = bundle.byId["commerce"]?.score ?? 0;
  bundle.byId["ops"] && (bundle.byId["ops"].evidences.push(ev("context", Math.min(0.1, commerce * 0.1), "Context from commerce")));
  return bundle;
}

// ------------------------- utils --------------------------------

function ev(id: string, value: number, label: string, source?: string, meta?: Record<string, any>): SignalEvidence {
  return { id, value: clamp01(value), label, source, meta };
}
