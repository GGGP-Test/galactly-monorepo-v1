// src/ai/crawl/crawl-worker.ts

/* A polite, pluggable crawl worker that:
 * 1) pulls CrawlTask items from an in-memory queue,
 * 2) enforces per-host throttling,
 * 3) fetches pages, extracts packaging/buyer intent signals,
 * 4) emits CrawlResult to a callback (router/orchestrator),
 * 5) cooperates with Compliance/DataGuard (sanitizes on free plan).
 *
 * Dependencies kept minimal: uses global fetch (Node 18+).
 */

import { DataGuard, redactPII } from "../compliance/compliance";
import type { Region } from "../compliance/compliance";
import { FeedbackStore } from "../feedback/feedback-store";

// ---------- Types (keep local; promote to shared types.ts later) ----------
export type Plan = "free" | "pro";

export interface CrawlTask {
  url: string;
  plan: Plan;
  tags?: string[];
  // Set if your scheduler did the robots/terms checks, otherwise leave undefined and we assume allowed = true
  robotsAllowed?: boolean;
  termsAllow?: boolean;
  referrer?: string;
  subjectRegion?: Region;        // for future geo-scoped compliance decisions
  priority?: number;             // higher = sooner
  maxBytes?: number;             // safety cap (default 1.5MB)
  timeoutMs?: number;            // per fetch timeout
}

export interface ExtractedSignals {
  title?: string;
  description?: string;
  emails?: string[];
  phones?: string[];
  hasCart?: boolean;
  ecommerceHint?: string;
  packagingKeywords: string[];
  rfqPhrases: string[];
  reviewHints: string[];         // e.g., "Trustpilot", "Google Reviews"
  platformHints: string[];       // e.g., "Shopify", "WooCommerce"
  analyticsHints: string[];      // e.g., "gtag", "fbq"
  careersLinks: string[];
  suppliersMentions: string[];   // e.g., "Uline", competitors
  blogRecentness?: { yyyy?: number; mm?: number };
  // quick derived intent subscores (0..1)
  demand?: number;
  procurement?: number;
  ops?: number;
  reputation?: number;
  urgency?: number;
}

export interface LeadCandidate {
  company?: string;
  website: string;
  region?: Region;
  signals: ExtractedSignals;
  tagset?: string[];
}

export interface CrawlResult {
  url: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
  http?: { status: number; bytes: number; contentType?: string };
  lead?: LeadCandidate;
  rawSnippet?: string; // (pro plan only) small raw excerpt for audit/debug
  startedAt: number;
  finishedAt: number;
  plan: Plan;
}

// ---------- Implementation ----------
type TaskQueueItem = { t: CrawlTask; enq: number };

export class CrawlWorker {
  private q: TaskQueueItem[] = [];
  private running = false;
  private hostLastFetch = new Map<string, number>();
  private seen = new Set<string>();
  private stopSignal = false;

  constructor(
    private onResult: (r: CrawlResult) => Promise<void> | void,
    private guard: DataGuard,
    private feedback: FeedbackStore,
    private opts: {
      perHostDelayMs?: number; // politeness gap
      globalConcurrency?: number; // reserved for future multi-worker
      defaultTimeoutMs?: number;
      defaultMaxBytes?: number;
      cacheTtlMs?: number;
    } = {}
  ) {}

  enqueue(task: CrawlTask) {
    // de-dup by normalized URL within TTL window; very simple approach
    const key = normUrl(task.url);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.q.push({ t: task, enq: Date.now() });
    // priority sort (descending)
    this.q.sort((a, b) => (b.t.priority ?? 0) - (a.t.priority ?? 0));
  }

  start() {
    if (this.running) return;
    this.stopSignal = false;
    this.running = true;
    this.loop().catch((e) => {
      this.running = false;
      console.error("[crawl-worker] loop error", e);
    });
  }

  stop() {
    this.stopSignal = true;
  }

  private async loop() {
    while (!this.stopSignal) {
      const item = this.q.shift();
      if (!item) {
        await sleep(150);
        continue;
      }
      const started = Date.now();
      let result: CrawlResult | undefined;
      try {
        result = await this.process(item.t, started);
      } catch (e: any) {
        result = {
          url: item.t.url,
          status: "error",
          reason: String(e?.message || e),
          startedAt: started,
          finishedAt: Date.now(),
          plan: item.t.plan,
        };
      }
      // Emit + log feedback outcome
      if (result) {
        await this.onResult(result);
        this.feedback.logIngestion({
          url: result.url,
          ok: result.status === "ok",
          status: result.http?.status,
          bytes: result.http?.bytes,
          reason: result.reason,
          ts: result.finishedAt,
        });
      }
    }
    this.running = false;
  }

  private async process(task: CrawlTask, startedAt: number): Promise<CrawlResult> {
    // Basic allow checks
    const allowed = this.guard.isCrawlAllowed({
      robotsAllowed: task.robotsAllowed ?? true,
      termsAllow: task.termsAllow ?? true,
    });
    if (!allowed) {
      return {
        url: task.url,
        status: "skipped",
        reason: "robots/terms disallow",
        startedAt,
        finishedAt: Date.now(),
        plan: task.plan,
      };
    }

    // politeness per-host
    const u = new URL(task.url);
    await this.respectHostDelay(u.host, this.opts.perHostDelayMs ?? 1500);

    // fetch
    const timeout = task.timeoutMs ?? this.opts.defaultTimeoutMs ?? 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const maxBytes = task.maxBytes ?? this.opts.defaultMaxBytes ?? 1_500_000;
    let res: Response | undefined;
    let buf: Uint8Array | undefined;
    try {
      res = await fetch(task.url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": ua() } });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/html")) {
        clearTimeout(timer);
        return {
          url: task.url,
          status: "skipped",
          reason: `non-html content (${ct})`,
          http: { status: res.status, bytes: 0, contentType: ct },
          startedAt,
          finishedAt: Date.now(),
          plan: task.plan,
        };
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) break;
          chunks.push(value);
          total += value.byteLength;
          if (total > maxBytes) break;
        }
        buf = concat(chunks, total);
      } else {
        const text = await res.text();
        buf = new TextEncoder().encode(text);
      }
    } finally {
      clearTimeout(timer);
      this.hostLastFetch.set(u.host, Date.now());
    }

    const html = safeDecode(buf || new Uint8Array());
    const signals = extractSignals(html, u);

    const lead: LeadCandidate = {
      company: guessCompanyName(signals.title, u),
      website: u.origin,
      region: task.subjectRegion,
      signals: signals,
      tagset: task.tags,
    };

    const rawSnippet = task.plan === "pro"
      ? html.slice(0, 2000)
      : redactPII(html.slice(0, 400)); // small, sanitized excerpt for free

    return {
      url: task.url,
      status: "ok",
      http: { status: res?.status ?? 0, bytes: buf?.byteLength ?? 0, contentType: "text/html" },
      lead,
      rawSnippet,
      startedAt,
      finishedAt: Date.now(),
      plan: task.plan,
    };
  }

  private async respectHostDelay(host: string, delay: number) {
    const last = this.hostLastFetch.get(host) ?? 0;
    const wait = Math.max(0, last + delay - Date.now());
    if (wait > 0) await sleep(wait);
  }
}

// ---------- helpers ----------
function ua() {
  return "LeadScoutBot/0.2 (+polite; contact: support@yourdomain.example)";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normUrl(url: string) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function concat(chunks: Uint8Array[], total: number) {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function safeDecode(u8: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(u8);
  } catch {
    return Buffer.from(u8).toString("utf8");
  }
}

function textBetween(html: string, start: RegExp, end: RegExp) {
  const s = html.search(start);
  if (s < 0) return undefined;
  const rest = html.slice(s);
  const e = rest.search(end);
  return rest.slice(0, e > 0 ? e : undefined);
}

function extractSignals(html: string, url: URL): ExtractedSignals {
  const lower = html.toLowerCase();

  const title = (textBetween(lower, /<title[^>]*>/i, /<\/title>/i) || "")
    .replace(/<[^>]+>/g, "")
    .trim();

  const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+>/i)?.[0] || "")
    .match(/content=["']([^"']+)["']/i)?.[1];

  const kw = findKeywords(lower, packagingLexicon);
  const rfq = findKeywords(lower, rfqLexicon);

  const emails = Array.from(lower.matchAll(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g)).map((m) => m[0]);
  const phones = Array.from(lower.matchAll(/\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?){1,2}\d{4}\b/g)).map((m) => m[0]);

  const hasCart = /add to cart|cart__item|data-cart/i.test(html);
  const shopify = /cdn\.shopify\.com|x-shopify|shopify-buy/i.test(html);
  const woo = /woocommerce|wp-content\/plugins\/woocommerce/i.test(html);
  const ecommerceHint = shopify ? "Shopify" : woo ? "WooCommerce" : hasCart ? "CustomCart" : "";

  const analyticsHints = [
    /gtag\(/i.test(html) ? "gtag" : null,
    /fbq\(/i.test(html) ? "fbq" : null,
    /gtm[-\s]?id/i.test(html) ? "gtm" : null,
  ].filter(Boolean) as string[];

  const careersLinks = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+jobs[^"']*|[^"']*careers[^"']*)["']/gi)).map(m => new URL(m[1], url).toString());

  const suppliersMentions = findKeywords(lower, ["uline", "veritiv", "grainger", "fastenal", "packlane", "packhelp", "staples"]);

  const reviewHints = findKeywords(lower, ["trustpilot", "google reviews", "yelp", "bbb.org", "sitejabber", "capterra"]);

  const blogDate = (html.match(/\b(20[1-3]\d)[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/) ||
                   html.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20[1-3]\d)\b/i));

  const urgency = /(limited time|ends\s+(soon|today|this week)|while supplies last|last chance)/i.test(lower) ? 0.7 : 0.1;
  const demand = Math.min(1, (kw.length / 6) + (hasCart ? 0.2 : 0) + (rfq.length ? 0.2 : 0));
  const procurement = Math.min(1, (rfq.length ? 0.6 : 0.1) + (suppliersMentions.length ? 0.2 : 0));
  const ops = Math.min(1, (ecommerceHint ? 0.3 : 0) + (analyticsHints.length ? 0.2 : 0));
  const reputation = Math.min(1, (reviewHints.length ? 0.4 : 0) + (/testimonials|case studies|reviews/i.test(lower) ? 0.2 : 0));

  return {
    title,
    description: metaDesc,
    emails,
    phones,
    hasCart,
    ecommerceHint,
    packagingKeywords: kw,
    rfqPhrases: rfq,
    reviewHints,
    platformHints: [ecommerceHint].filter(Boolean) as string[],
    analyticsHints,
    careersLinks,
    suppliersMentions,
    blogRecentness: blogDate
      ? typeof blogDate[1] === "string" && blogDate[1].length === 4
        ? { yyyy: Number(blogDate[1]) }
        : { yyyy: Number(blogDate[2]) }
      : undefined,
    demand,
    procurement,
    ops,
    reputation,
    urgency,
  };
}

function findKeywords(text: string, lex: string[]) {
  const out = new Set<string>();
  for (const k of lex) {
    if (text.includes(k.toLowerCase())) out.add(k);
  }
  return Array.from(out);
}

const packagingLexicon = [
  "stretch wrap", "stretch film", "shrink film", "pallet wrap", "strapping",
  "corrugated", "carton", "box", "mailer", "poly mailer", "bubble mailer",
  "void fill", "air pillow", "kraft paper", "tape", "bopp tape", "custom box",
  "die cut", "inserts", "fulfillment", "3pl", "co-packer", "packaging supplier",
  "packaging manufacturer", "warehouse supplies"
];

const rfqLexicon = [
  "request a quote", "rfq", "quote form", "get a quote", "bulk pricing",
  "wholesale", "moq", "minimum order", "distributor", "reseller"
];

function guessCompanyName(title: string | undefined, url: URL) {
  if (title) {
    // Remove separators and generic suffixes
    const cleaned = title
      .split(/[-|•·–—]/)[0]
      .replace(/\b(home|official site|welcome)\b/gi, "")
      .trim();
    if (cleaned.length > 2) return cleaned;
  }
  const host = url.hostname.replace(/^www\./, "");
  const root = host.split(".").slice(0, -1).join(" ");
  return root.charAt(0).toUpperCase() + root.slice(1);
}
