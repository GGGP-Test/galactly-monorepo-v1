import { Router, Request, Response } from "express";
import { setTimeout as delay } from "timers/promises";

// ---------- Types ----------
type Region = "usca" | "eu" | "global";

interface FindBuyersBody {
  domain?: string;
  host?: string;
  supplier?: string;
  url?: string;
  region?: Region | string;
  radiusMi?: number | string;
  seedPersona?: {
    product?: string;
    solves?: string;
    titles?: string[];
  };
}

interface Lead {
  id: string;
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: "hot" | "warm";
  why: string;
}

interface Discovery {
  domain: string;
  url: string;
  text: string;         // merged text from homepage/about
  signals: string[];    // extracted keywords/clauses
  summary: string;      // short summary line
}

// ---------- Small helpers ----------
const buyers = Router();

function pick<T>(...vals: (T | undefined | null)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== "") return v as T;
  return undefined;
}

function normalizeDomain(raw?: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    let h = (u.hostname || "").toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h || null;
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

// Minimal, safe fetch with timeouts and graceful fallback
async function fetchText(url: string, timeoutMs = 3500): Promise<string> {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow" as RequestRedirect });
    if (!r.ok) return "";
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text") || ct.includes("html") || ct.includes("json")) {
      return await r.text();
    }
    return "";
  } catch {
    return "";
  } finally {
    clearTimeout(tm);
  }
}

// Very lightweight readability: strip tags, collapse whitespace
function toPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Domain discovery (homepage + /about if present)
async function discoverSupplier(domain: string): Promise<Discovery> {
  const base = `https://${domain}`;
  const [home, about] = await Promise.all([
    fetchText(base).catch(() => ""),
    fetchText(`${base}/about`).catch(() => ""),
  ]);

  const merged = `${home}\n${about}`;
  const text = toPlainText(merged);

  // cheap signals
  const S: Record<string, RegExp> = {
    stretch: /\bstretch(?:[-\s]?film|[-\s]?wrap)?\b/,
    shrink: /\bshrink(?:[-\s]?film|[-\s]?wrap)?\b/,
    corrugated: /\bcorrugat(?:ed|ion)\b|\bbox(es)?\b/,
    mailers: /\bpoly(?: |-)?mailers?\b|\bmailer\b/,
    tape: /\bpack(?:ing)?\s?tape\b|\btapes\b|\bhot\s?melt\b/,
    strapping: /\bstrap(?:ping)?\b|\bpolypropylene strap\b/,
    coldchain: /\bcold(?: |-)?chain\b|\brefrigerated\b|\bcold storage\b|\bgell? pack\b/,
    ecommerce: /\bshopify\b|\bwoocommerce\b|\bcheckout\b|\breturns?\b/,
    green: /\bcompostable\b|\brecycl(?:e|able|ed)\b|\bsustainable\b/,
    machinery: /\b(pre[-\s]?stretch|prestretch|semi-automatic|automatic|turntable|conveyor)\b/,
    pallet: /\bpallet(?:iz|is)e|pallet\b/,
    film_specs: /\bgauge\b|\bmic(?:ron)?\b|\bhand(?: |-)?grade\b|\bmachine(?: |-)?grade\b/
  };

  const signals: string[] = [];
  for (const [k, rx] of Object.entries(S)) {
    if (rx.test(text)) signals.push(k);
  }

  const summary =
    signals.length > 0
      ? `Signals: ${signals.slice(0, 6).join(", ")}`
      : "No strong packaging signals detected";

  return { domain, url: base, text, signals, summary };
}

// Map signals -> target buyer titles
function titlesFromSignals(signals: string[]): string[] {
  const T = new Set<string>();
  if (signals.some(s => ["stretch", "shrink", "pallet", "machinery"].includes(s))) {
    T.add("Warehouse Manager");
    T.add("Shipping Supervisor");
    T.add("Operations Manager");
    T.add("Purchasing Manager");
  }
  if (signals.includes("corrugated") || signals.includes("mailers") || signals.includes("ecommerce")) {
    T.add("E-commerce Fulfillment Manager");
    T.add("DC Operations Manager");
    T.add("Logistics Manager");
  }
  if (signals.includes("coldchain")) {
    T.add("Food Safety Manager");
    T.add("Cold Chain Manager");
    T.add("Quality Assurance Manager");
  }
  if (signals.includes("green")) {
    T.add("Sustainability Manager");
    T.add("Packaging Engineer");
  }
  // Defaults
  if (T.size === 0) {
    T.add("Purchasing Manager");
    T.add("Operations Manager");
    T.add("Warehouse Manager");
  }
  return Array.from(T);
}

// Try to persist to whatever store /leads uses.
// We don’t know the exact API, so this is defensive.
// If your store exposes a different global or function, I can wire to it once I see that file.
function tryPersist(region: string, temp: "hot" | "warm", items: Lead[]) {
  try {
    // Option A: a global store object with add()
    // @ts-ignore
    if (globalThis.__LEADS_STORE__?.add) {
      // @ts-ignore
      globalThis.__LEADS_STORE__.add({ region, temp, items });
      return true;
    }
    // Option B: buckets Map
    // @ts-ignore
    if (!globalThis.__LEADS_BUCKETS__) {
      // @ts-ignore
      globalThis.__LEADS_BUCKETS__ = new Map<string, Lead[]>();
    }
    // @ts-ignore
    const buckets: Map<string, Lead[]> = globalThis.__LEADS_BUCKETS__;
    const key = `${region}:${temp}`;
    const cur = buckets.get(key) || [];
    buckets.set(key, cur.concat(items));
    return true;
  } catch {
    return false;
  }
}

// ---------- Route ----------
buyers.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  const b = (req.body || {}) as FindBuyersBody;

  const domainRaw =
    pick(b.domain, b.host, b.supplier, b.url, req.query.domain as string, req.query.host as string) ||
    (req.headers["x-domain"] as string | undefined);

  const domain = normalizeDomain(domainRaw || "");
  if (!domain) {
    return res.status(400).json({ ok: false, error: "domain is required" });
  }

  const region = String(b.region || req.query.region || "usca").toLowerCase();
  const radiusMi = Number(b.radiusMi || req.query.radiusMi || 50) || 50;

  // 1) Discover supplier from website
  const disc = await discoverSupplier(domain);

  // 2) Decide buyer titles (seedPersona, if provided, wins but we still enrich)
  let titles = titlesFromSignals(disc.signals);
  if (b.seedPersona?.titles?.length) {
    const extra = b.seedPersona.titles.map(t => String(t).trim()).filter(Boolean);
    titles = Array.from(new Set([...extra, ...titles]));
  }

  // 3) Synthesize provisional candidates (warm) so the panel shows rows immediately
  const createdAt = nowIso();
  const leads: Lead[] = titles.slice(0, 3).map((title, i) => ({
    id: `L_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`,
    host: domain,
    platform: "web",
    title: `${title} @ ${domain}`,
    created: createdAt,
    temp: "warm",
    why: disc.summary,
  }));

  // (optional) turn a strong e-comm or cold-chain signal into one “hot”
  let hot = 0;
  if (disc.signals.includes("ecommerce") || disc.signals.includes("coldchain")) {
    leads[0] = { ...leads[0], temp: "hot" };
    hot = 1;
  }

  const warm = leads.filter(l => l.temp === "warm").length;

  // 4) Persist if we can
  tryPersist(region, "warm", leads.filter(l => l.temp === "warm"));
  if (hot) tryPersist(region, "hot", leads.filter(l => l.temp === "hot"));

  // 5) Small debounce to give the /leads poller a moment (UX nicety)
  await delay(120);

  return res.json({
    ok: true,
    created: leads.length,
    hot,
    warm,
    region,
    radiusMi,
    debug: { domain, signals: disc.signals.slice(0, 12) },
  });
});

export default buyers;
