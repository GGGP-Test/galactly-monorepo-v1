import { Router, Request, Response } from "express";
import crypto from "crypto";

// ---------- Minimal BleedStore surface (what we actually use here) ----------
type LeadTemp = "hot" | "warm";
type LeadStatus = "candidate" | "contacted" | "qualified" | "won" | "lost";

interface LeadRecord {
  id: string;
  tenantId: string;
  host: string;
  platform: "web";
  title: string;
  createdAt: string;
  updatedAt: string;
  temp?: LeadTemp;
  status?: LeadStatus;
  why?: string;
  scores?: Record<string, number>;
  region?: string;
}

interface Evidence {
  id: string;
  ts: number;
  tenantId: string;
  leadId: string;
  kind: string;
  data?: any;
  text?: string;
}

interface BleedStore {
  upsertLead(lead: Partial<LeadRecord> & { tenantId: string }): Promise<LeadRecord>;
  addEvidence(ev: Omit<Evidence, "id" | "ts"> & { ts?: number }): Promise<Evidence>;
  updateScores(tenantId: string, id: string, scores: Record<string, number>): Promise<LeadRecord | undefined>;
  setStatus(tenantId: string, id: string, status: LeadStatus): Promise<LeadRecord | undefined>;
}

// Resolve store from app.locals or a global (fallback for dev)
function resolveStore(req: Request): BleedStore | undefined {
  // @ts-ignore
  if (req.app?.locals?.store) return req.app.locals.store as BleedStore;
  // @ts-ignore
  if (globalThis.__BLEED_STORE__) return globalThis.__BLEED_STORE__ as BleedStore;
  return undefined;
}

// ---------- Helpers ----------
const buyers = Router();

function now() { return new Date().toISOString(); }
function shaId(...parts: string[]) {
  return "L_" + crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}
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
  } catch { return null; }
}
async function fetchText(url: string, timeoutMs = 4000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow" as RequestRedirect });
    if (!r.ok) return "";
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text") || ct.includes("html") || ct.includes("json")) return await r.text();
    return "";
  } catch { return ""; } finally { clearTimeout(t); }
}
function toText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
             .replace(/<style[\s\S]*?<\/style>/gi, " ")
             .replace(/<[^>]+>/g, " ")
             .replace(/\s+/g, " ")
             .toLowerCase()
             .trim();
}

// Detect packaging signals (cheap, fast)
function detectSignals(text: string): string[] {
  const R: Record<string, RegExp> = {
    stretch: /\bstretch(?:[-\s]?(film|wrap))?\b/,
    shrink:  /\bshrink(?:[-\s]?(film|wrap))?\b/,
    pallet:  /\bpallet(?:iz|is)e|\bpallet\b/,
    corr:    /\bcorrugat(?:ed|ion)\b|\bbox(es)?\b/,
    mailer:  /\bpoly(?: |-)?mailers?\b|\bmailer\b/,
    tape:    /\bpack(?:ing)?\s?tape\b|\bhot\s?melt\b/,
    strap:   /\bstrap(?:ping)?\b/,
    cold:    /\bcold(?: |-)?chain\b|\brefrigerated\b|\bcold storage\b/,
    shop:    /\bshopify\b|\bwoocommerce\b|\bbigcommerce\b|\bcheckout\b|\breturns?\b/,
    green:   /\bcompostable\b|\brecycl(?:e|able|ed)\b|\bsustainab(le|ility)\b/,
    mach:    /\b(pre[-\s]?stretch|prestretch|semi-automatic|automatic|turntable|conveyor)\b/,
    spec:    /\bgauge\b|\bmic(?:ron)?\b|\bhand(?: |-)?grade\b|\bmachine(?: |-)?grade\b/
  };
  const out: string[] = [];
  for (const [k, rx] of Object.entries(R)) if (rx.test(text)) out.push(k);
  return out;
}

function titlesFromSignals(signals: string[]): string[] {
  const T = new Set<string>();
  if (signals.some(s => ["stretch", "shrink", "pallet", "mach"].includes(s))) {
    T.add("Warehouse Manager"); T.add("Shipping Supervisor"); T.add("Operations Manager"); T.add("Purchasing Manager");
  }
  if (signals.some(s => ["corr", "mailer", "shop"].includes(s))) {
    T.add("E-commerce Fulfillment Manager"); T.add("DC Operations Manager"); T.add("Logistics Manager");
  }
  if (signals.includes("cold")) { T.add("Cold Chain Manager"); T.add("Food Safety Manager"); }
  if (signals.includes("green")) { T.add("Sustainability Manager"); T.add("Packaging Engineer"); }
  if (T.size === 0) { T.add("Purchasing Manager"); T.add("Operations Manager"); T.add("Warehouse Manager"); }
  return Array.from(T);
}

function fitScore(signals: string[]): number {
  // very cheap scoring; the list route likely thresholds by temp -> we’ll also set temp explicitly via setStatus + scores
  const w: Record<string, number> = {
    stretch: 0.25, shrink: 0.25, pallet: 0.2, mach: 0.2, corr: 0.15, mailer: 0.15,
    shop: 0.15, cold: 0.25, green: 0.1, tape: 0.1, strap: 0.1, spec: 0.1
  };
  let s = 0;
  for (const k of signals) s += w[k] || 0.05;
  return Math.max(0, Math.min(1, s));
}

// ---------- Route ----------
buyers.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  const store = resolveStore(req);
  const tenantId = String(req.header("x-api-key") || "demo");

  // Be liberal in what we accept
  const domainRaw =
    pick<string>(
      (req.body && (req.body.domain || req.body.host || req.body.supplier || req.body.url)),
      req.query.domain as string,
      req.query.host as string,
      req.header("x-domain") as string
    );
  const domain = normalizeDomain(domainRaw || "");
  if (!domain) return res.status(400).json({ ok: false, error: "domain is required" });

  const region = String(req.body?.region || req.query.region || "usca").toLowerCase();

  // 1) Website discovery
  const base = `https://${domain}`;
  const [home, about] = await Promise.all([ fetchText(base), fetchText(`${base}/about`) ]);
  const text = toText(`${home}\n${about}`);
  const signals = detectSignals(text);
  const titles = titlesFromSignals(signals);
  const summary = signals.length ? `Signals: ${signals.slice(0,6).join(", ")}` : "No strong packaging signals detected";

  // 2) Always create at least 3 provisional candidates
  const createdAt = now();
  const names = titles.slice(0, 3);
  const candidates: LeadRecord[] = names.map((title, i) => ({
    id: shaId(tenantId, domain, title, String(i), createdAt),
    tenantId,
    host: domain,
    platform: "web",
    title: `${title} @ ${domain}`,
    createdAt,
    updatedAt: createdAt,
    why: summary,
    region
  }));

  // If for any reason titles[] is empty, fallback to three generic roles
  if (candidates.length === 0) {
    ["Purchasing Manager", "Operations Manager", "Warehouse Manager"].forEach((t, i) => {
      candidates.push({
        id: shaId(tenantId, domain, t, String(i), createdAt),
        tenantId, host: domain, platform: "web",
        title: `${t} @ ${domain}`, createdAt, updatedAt: createdAt, why: summary, region
      });
    });
  }

  // 3) Persist to BleedStore (if available); otherwise we still return counts
  let persisted = 0, hot = 0, warm = 0;
  for (const lead of candidates) {
    try {
      if (store) {
        // upsert
        const r = await store.upsertLead(lead);
        // scoring + status/temp
        const fit = fitScore(signals);
        await store.updateScores(tenantId, r.id, { leadFit: fit });
        const temp: LeadTemp = fit >= 0.65 ? "hot" : "warm";
        await store.setStatus(tenantId, r.id, "candidate");
        // We keep temp in scores — your /leads route likely maps temp from scores or status; we set both.
        await store.updateScores(tenantId, r.id, { tempHot: temp === "hot" ? 1 : 0, tempWarm: temp === "warm" ? 1 : 0 });
        // evidence for transparency
        await store.addEvidence({ tenantId, leadId: r.id, kind: "discovery", text: summary, data: { signals } });
        persisted++;
        if (temp === "hot") hot++; else warm++;
      } else {
        // No store mounted — nothing to persist, but don’t fail
        const fit = fitScore(signals);
        if (fit >= 0.65) hot++; else warm++;
      }
    } catch {
      // keep going
    }
  }

  return res.json({
    ok: true,
    created: candidates.length,
    persisted,
    hot, warm,
    region,
    debug: { domain, signals: signals.slice(0, 10) }
  });
});

export default buyers;
