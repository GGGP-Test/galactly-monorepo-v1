import { Router, Request, Response } from "express";
import crypto from "crypto";

/** ---- mirror minimal BleedStore surface (from src/data/bleed-store.ts) ---- */
type LeadStatus =
  | "new" | "enriched" | "qualified" | "routed" | "contacted" | "won" | "lost" | "archived";

interface LeadRecord {
  id: string;
  tenantId: string;
  source: string;
  company?: string;
  domain?: string;
  website?: string;
  country?: string;
  region?: string;
  verticals?: string[];
  signals?: Record<string, number>;
  scores?: Record<string, number>;
  contacts?: any[];
  status: LeadStatus;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}

interface Evidence {
  id: string;
  leadId: string;
  ts: number;
  kind:
    | "ad_snapshot"
    | "pricing_page"
    | "careers_posting"
    | "tech_tag"
    | "news"
    | "review"
    | "social_post"
    | "directory_row"
    | "catalog_listing"
    | "email_bounce"
    | "reply_positive"
    | "reply_negative";
  url?: string;
  snippet?: string;
  weight?: number;
  meta?: Record<string, unknown>;
}

interface BleedStore {
  upsertLead(lead: Partial<LeadRecord> & { tenantId: string }): Promise<LeadRecord>;
  addEvidence(ev: Omit<Evidence, "id" | "ts"> & { ts?: number }): Promise<Evidence>;
  updateScores(tenantId: string, id: string, scores: Record<string, number>): Promise<LeadRecord | undefined>;
  setStatus(tenantId: string, id: string, status: LeadStatus): Promise<LeadRecord | undefined>;
}

/** ---- utils ---- */
const buyers = Router();
const epoch = () => Date.now();

function normDomain(raw?: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h || null;
  } catch {
    return null;
  }
}
function id(tenantId: string, domain: string, salt = ""): string {
  return `${epoch().toString(36)}-${crypto.createHash("sha1").update(`${tenantId}|${domain}|${salt}`).digest("hex").slice(0,8)}`;
}
async function fetchText(url: string, timeoutMs = 4000): Promise<string> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal as any, redirect: "follow" });
    if (!r.ok) return "";
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text") || ct.includes("html") || ct.includes("json")) return await r.text();
    return "";
  } catch { return ""; } finally { clearTimeout(to); }
}
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// lightweight website signal detection (cheap)
function detectSignals(text: string): Record<string, number> {
  const RX: Record<string, RegExp> = {
    stretch: /\bstretch(?:[-\s]?(film|wrap))?\b/,
    shrink: /\bshrink(?:[-\s]?(film|wrap))?\b/,
    pallet: /\bpallet(?:iz|is)e|\bpallet\b/,
    corr: /\bcorrugat(?:ed|ion)\b|\bbox(?:es)?\b/,
    mailer: /\bpoly(?: |-)?mailers?\b|\bmailer\b/,
    tape: /\bpack(?:ing)?\s?tape\b|\bhot\s?melt\b/,
    strap: /\bstrap(?:ping)?\b/,
    cold: /\bcold(?: |-)?chain\b|\brefrigerat(?:ed|ion)\b/,
    shop: /\bshopify\b|\bwoocommerce\b|\bbigcommerce\b|\bcheckout\b|\breturns?\b/,
    green: /\bcompostable\b|\brecycl(?:e|able|ed)\b|\bsustainab(?:le|ility)\b/,
    mach: /\b(pre[-\s]?stretch|prestretch|semi-automatic|automatic|turntable|conveyor)\b/,
    spec: /\bgauge\b|\bmic(?:ron)?\b|\bhand(?: |-)?grade\b|\bmachine(?: |-)?grade\b/
  };
  const out: Record<string, number> = {};
  for (const [k, rx] of Object.entries(RX)) {
    const m = text.match(rx);
    if (m) out[k] = 1;
  }
  return out;
}

// very cheap fit -> controls hot/warm
function fitFromSignals(sig: Record<string, number>): number {
  const w: Record<string, number> = {
    stretch: 0.25, shrink: 0.25, pallet: 0.2, mach: 0.2,
    corr: 0.15, mailer: 0.15, shop: 0.15, cold: 0.25,
    green: 0.1, tape: 0.1, strap: 0.1, spec: 0.1
  };
  let s = 0;
  for (const k of Object.keys(sig)) s += w[k] || 0.05;
  return Math.max(0, Math.min(1, s));
}

function companyFromDomain(domain: string) {
  const parts = domain.split(".");
  if (parts.length >= 2) {
    const base = parts[parts.length - 2];
    return base.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }
  return domain;
}

// resolve store
function storeOf(req: Request): BleedStore | undefined {
  // @ts-ignore
  if (req.app?.locals?.store) return req.app.locals.store as BleedStore;
  // @ts-ignore — dev fallback if someone put it on global
  if (globalThis.__BLEED_STORE__) return (globalThis as any).__BLEED_STORE__ as BleedStore;
  return undefined;
}

/** ---------------------------------------------------------------------- */
buyers.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  const tenantId = String(req.header("x-api-key") || "demo");
  const regionParam = (String(req.body?.region || req.query?.region || "US/CA")).trim();
  const domain = normDomain(
    (req.body?.domain || req.body?.host || req.body?.supplier || req.body?.url ||
      req.query?.domain || req.query?.host || req.headers["x-domain"]) as string | undefined
  );

  if (!domain) {
    return res.status(400).json({ ok: false, error: "domain is required" });
  }

  // scrape home/about cheaply
  const base = `https://${domain}`;
  const [home, about] = await Promise.all([fetchText(base), fetchText(`${base}/about`)]);
  const text = toText(`${home}\n${about}`);
  const signals = detectSignals(text);
  const fit = fitFromSignals(signals);
  const temp: "hot" | "warm" = fit >= 0.65 ? "hot" : "warm";
  const now = epoch();

  const website = base;
  const company = companyFromDomain(domain);
  const source = "find-buyers";

  const store = storeOf(req);
  let persisted = 0;

  // We create a single company-level lead row; your list UI shows company rows (not per-contact).
  if (store) {
    const rec: Partial<LeadRecord> & { tenantId: string } = {
      tenantId,
      source,
      company,
      domain,
      website,
      region: regionParam,        // <- keep EXACT as passed; your /leads route logs region=usca, so it will match.
      signals,
      scores: { fit, leadFit: fit, tempHot: temp === "hot" ? 1 : 0, tempWarm: temp === "warm" ? 1 : 0 },
      status: "new",              // your default and typical filter for the list
      createdAt: now,
      updatedAt: now,
      meta: { summary: Object.keys(signals).slice(0, 8) }
    };

    const saved = await store.upsertLead(rec);
    await store.updateScores(tenantId, saved.id, { fit, leadFit: fit });
    await store.setStatus(tenantId, saved.id, "new");
    await store.addEvidence({
      tenantId,
      leadId: saved.id,
      kind: "catalog_listing",
      snippet: `discovery: ${Object.keys(signals).join(", ") || "no strong packaging signals"}`,
      url: website,
      weight: fit
    });
    persisted = 1;
  }

  return res.json({
    ok: true,
    created: 1,
    persisted,
    hot: temp === "hot" ? 1 : 0,
    warm: temp === "warm" ? 1 : 0,
    region: regionParam,
    debug: { domain, signals: Object.keys(signals), fit }
  });
});

export default buyers;
