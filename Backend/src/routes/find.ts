// Backend/src/routes/find.ts
//
// POST /api/v1/leads/find-buyers
// One-file, self-contained route that:
//  1) Accepts supplier domain (supplierDomain | domain | website).
//  2) Runs a free, deterministic heuristic to infer a supplier persona.
//  3) Optionally refines that persona with a single cheap LLM call via OpenRouter
//     (only if OPENROUTER_API_KEY is set; otherwise it skips).
//  4) Returns the persona (human-readable, compact) + debug crumbs.
//  5) Keeps a simple in-memory store so repeat clicks don’t re-run work.
//
// Notes:
//  - No external imports beyond Express types.
//  - No DB/FS side-effects in this step (we’ll wire your PII Vault next).
//  - Designed to compile cleanly with strict TS and no esModuleInterop hassles.
//
// Env (optional):
//   OPENROUTER_API_KEY = <your key>
//   OPENROUTER_MODEL   = google/gemini-1.5-flash  (default)

import type { Express, Request, Response } from "express";

type RegionCode = "US/CA" | "EU" | "APAC" | "LATAM" | "GLOBAL";

interface SupplierPersona {
  domain: string;
  sectors: string[];
  productOffer: string;
  solves: string;
  buyerTitles: string[];
  regions?: RegionCode[];
  keywords: string[];
  confidence: number;     // 0..1
  explains: string[];     // short human reasons
  createdAt: string;      // ISO
  source: "heuristic" | "heuristic+llm";
}

interface EnsureOpts {
  tenantId: string;
  domain: string;
  force?: boolean;
  allowLLM?: boolean;
  llmModel?: string;
}

interface StoredPersona extends SupplierPersona {
  tenantId: string;
  updatedAt: string;
}

const mem = new Map<string, StoredPersona>(); // key = `${tenantId}:${domain}`

// ---------- mount (exported) ----------

export function mountFind(app: Express) {
  app.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
    try {
      const body: any = (req as any).body || {};
      const supplierDomain: string =
        body.supplierDomain || body.domain || body.website || "";

      if (!supplierDomain || typeof supplierDomain !== "string") {
        res.status(400).json({ ok: false, error: "supplierDomain (or domain) is required" });
        return;
      }

      // In your stack you likely carry tenant on auth/session; for now derive a stable default.
      const tenantId = (req.headers["x-tenant-id"] as string) || "t_default";

      const persona = await ensureSupplierPersona({
        tenantId,
        domain: supplierDomain,
        force: !!body.force,
        allowLLM: process.env.OPENROUTER_API_KEY ? true : false,
        llmModel: process.env.OPENROUTER_MODEL || "google/gemini-1.5-flash",
      });

      // Return in the shape the panel can consume immediately
      res.json({
        ok: true,
        supplierDomain: persona.domain,
        persona: {
          productOffer: persona.productOffer,
          solves: persona.solves,
          buyerTitles: persona.buyerTitles,
          sectors: persona.sectors,
          regions: persona.regions || ["US/CA"],
          keywords: persona.keywords,
          confidence: persona.confidence,
          explains: persona.explains,
          source: persona.source,
        },
        // leads are populated by downstream search providers; keep empty for now
        leads: [],
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  console.log("[routes] mounted find from ./routes/find");
}

// Provide default export too (so either import style works)
export default mountFind;

// ---------- persona ensure (heuristic + optional LLM via OpenRouter) ----------

async function ensureSupplierPersona(opts: EnsureOpts): Promise<SupplierPersona> {
  const domain = normalizeDomain(opts.domain);
  const k = key(opts.tenantId, domain);
  const existing = mem.get(k);
  if (existing && !opts.force) {
    return stripTenant(existing);
  }

  const html = await safeFetchHTML(domain);
  let persona = html
    ? buildHeuristicPersona(domain, html)
    : fallbackPersona(domain, "Homepage fetch failed — using conservative default persona");

  if (opts.allowLLM && html) {
    persona = await maybeRefineWithOpenRouter(persona, stripTags(html).slice(0, 6000), opts.llmModel || "google/gemini-1.5-flash");
  }

  const rec = stamp(opts.tenantId, persona);
  mem.set(k, rec);
  return persona;
}

// ---------- heuristics (free & deterministic) ----------

const FETCH_TIMEOUT_MS = 12000;

function normalizeDomain(raw: string): string {
  try {
    const s = raw.trim();
    const url = s.includes("://") ? new URL(s) : new URL(`https://${s}`);
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

async function safeFetchHTML(host: string): Promise<string | "" > {
  try {
    const url = `https://${host}/`;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(to);
    if (!res.ok) return "";
    const html = await res.text();
    return html.slice(0, 500_000);
  } catch {
    return "";
  }
}

function pickTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim().replace(/\s+/g, " ").slice(0, 140) : "";
}

function pickMetaDesc(html: string): string {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+>/i);
  if (!m) return "";
  const c = m[0].match(/content=["']([\s\S]*?)["']/i);
  return c ? decodeEntities(c[1]).trim().replace(/\s+/g, " ").slice(0, 200) : "";
}

function pickH1H2(html: string): string[] {
  const out: string[] = [];
  const re = /<(h1|h2)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const txt = stripTags(m[2]);
    if (txt) out.push(txt.slice(0, 160));
    if (out.length >= 10) break;
  }
  return out;
}

function stripTags(s: string) {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9\-\+\/\.]{1,}/g) || []).slice(0, 10000);
}

function scoreKeywords(tokens: string[]) {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  const inc = (...words: string[]) => words.reduce((sum, w) => sum + (counts.get(w) || 0), 0);

  // Broad packaging taxonomy — extend over time
  const signals = {
    stretch: inc("stretch", "film", "wrap", "pre-stretch"),
    shrink: inc("shrink", "film", "tunnel"),
    corrugate: inc("box", "carton", "corrugate", "corrugated"),
    mailers: inc("mailer", "poly", "bubble", "padded"),
    voidfill: inc("void", "fill", "air", "pillows", "paper"),
    tape: inc("tape", "adhesive"),
    labels: inc("label", "labels"),
    pallets: inc("pallet", "pallets"),
    warehouse: inc("warehouse", "warehousing", "3pl", "fulfillment", "distribution"),
    logistics: inc("logistics", "supply", "freight", "shipping", "carrier"),
    machinery: inc("machine", "automatic", "wrapper", "turntable", "case", "sealer"),
    sustainability: inc("recycl", "eco", "green", "footprint", "waste"),
    coldchain: inc("cold", "insulated", "gel", "ice", "refrigerated"),
    ecom: inc("ecom", "e-commerce", "shopify", "woocommerce", "marketplace"),
    food: inc("food", "beverage", "fda", "usda"),
    pharma: inc("pharma", "gmp", "medical", "health"),
  };

  return { counts, signals };
}

function buildHeuristicPersona(domain: string, html: string): SupplierPersona {
  const title = pickTitle(html);
  const desc = pickMetaDesc(html);
  const heads = pickH1H2(html);
  const bag = [title, desc, ...heads].join(" • ");
  const tokens = tokenize(bag);
  const { signals } = scoreKeywords(tokens);

  const explains: string[] = [];
  const keywords: string[] = [];
  const sectors = new Set<string>(["Packaging"]);
  const buyerTitles = new Set<string>(["Purchasing Manager"]);

  let productOffer = "Packaging supplies";
  let solves = "Secure shipments; efficient operations";
  let confidence = 0.50;

  if (signals.warehouse) { sectors.add("Logistics"); buyerTitles.add("Warehouse Manager"); buyerTitles.add("Operations Manager"); confidence += 0.06; }
  if (signals.logistics) { sectors.add("Logistics"); buyerTitles.add("COO"); confidence += 0.04; }
  if (signals.machinery) { keywords.push("machinery"); buyerTitles.add("Maintenance Manager"); confidence += 0.03; }
  if (signals.sustainability) { keywords.push("sustainability"); confidence += 0.02; }
  if (signals.ecom) { sectors.add("E-commerce"); buyerTitles.add("Fulfillment Manager"); confidence += 0.04; }
  if (signals.food) { sectors.add("Food & Bev"); keywords.push("FDA/GMP"); confidence += 0.03; }
  if (signals.pharma) { sectors.add("Healthcare"); keywords.push("GMP/Validation"); confidence += 0.03; }

  // Product specialization (pick the strongest)
  const specialties: Array<{score:number; offer:string; solve:string; kw:string[]}> = [
    { score: signals.stretch, offer: "Stretch film & pallet wrap", solve: "Stabilize pallets; reduce damage", kw: ["stretch-film","pallet-wrap"] },
    { score: signals.shrink, offer: "Shrink film & systems", solve: "Tight retail-ready bundling", kw: ["shrink-film"] },
    { score: signals.corrugate, offer: "Corrugated boxes & cartons", solve: "Right-size shipping protection", kw: ["corrugate","cartons"] },
    { score: signals.mailers, offer: "Mailers & protective bags", solve: "Low-weight DTC protection", kw: ["mailers","poly","bubble"] },
    { score: signals.voidfill, offer: "Void fill (air/paper)", solve: "Prevent in-box movement", kw: ["void-fill"] },
    { score: signals.tape, offer: "Carton sealing tapes", solve: "Secure closures; fewer opens", kw: ["tape"] },
    { score: signals.labels, offer: "Labels & print", solve: "Inventory/brand identification", kw: ["labels"] },
    { score: signals.coldchain, offer: "Cold-chain packaging", solve: "Maintain temp in transit", kw: ["cold-chain"] },
  ];
  specialties.sort((a,b)=>b.score-a.score);
  if (specialties[0].score > 0) {
    productOffer = specialties[0].offer;
    solves = specialties[0].solve;
    keywords.push(...specialties[0].kw);
    confidence += Math.min(0.12, 0.02 * specialties[0].score); // bounded bump
  }

  if (title) explains.push(`<title> hints: ${title.slice(0, 80)}`);
  if (desc) explains.push(`<meta description> mentions: ${desc.slice(0, 80)}`);
  if (heads.length) explains.push(`Headings sample: ${heads[0].slice(0, 80)}`);

  const persona: SupplierPersona = {
    domain,
    sectors: Array.from(sectors),
    productOffer,
    solves,
    buyerTitles: Array.from(buyerTitles),
    regions: ["US/CA"],
    keywords: dedupe(keywords),
    confidence: Math.max(0.45, Math.min(0.9, confidence)),
    explains,
    createdAt: new Date().toISOString(),
    source: "heuristic",
  };
  return persona;
}

function fallbackPersona(domain: string, reason: string): SupplierPersona {
  return {
    domain,
    sectors: ["Packaging"],
    productOffer: "Packaging supplies",
    solves: "Protects shipments; basic ops fit",
    buyerTitles: ["Purchasing Manager", "Warehouse Manager"],
    regions: ["US/CA"],
    keywords: [],
    confidence: 0.45,
    explains: [reason],
    createdAt: new Date().toISOString(),
    source: "heuristic",
  };
}

function dedupe(arr: string[]): string[] {
  const s = new Set(arr.filter(Boolean).map(x => x.trim()).filter(Boolean));
  return Array.from(s);
}

// ---------- OpenRouter (optional) ----------

async function maybeRefineWithOpenRouter(persona: SupplierPersona, pageText: string, model: string): Promise<SupplierPersona> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return persona;

  const prompt = `
You are an analyst that classifies B2B packaging suppliers from a home-page snippet.
Given a DRAFT persona and SNIPPET, return a COMPACT JSON patch (no prose) with:
- productOffer (<= 8 words)
- solves (<= 12 words)
- buyerTitles (<= 4 concise titles)
- sectors (<= 3)
- keywords (<= 6)
Return ONLY JSON with those keys. If uncertain, keep draft values.

DRAFT:
${JSON.stringify(persona)}

SNIPPET:
${pageText}
`.trim();

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "google/gemini-1.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 320,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    const patch = JSON.parse(content);

    const refined: SupplierPersona = {
      ...persona,
      productOffer: (patch.productOffer || persona.productOffer)?.toString()?.slice(0, 80),
      solves: (patch.solves || persona.solves)?.toString()?.slice(0, 120),
      buyerTitles: dedupe((patch.buyerTitles || persona.buyerTitles) as string[]),
      sectors: dedupe((patch.sectors || persona.sectors) as string[]),
      keywords: dedupe([...(persona.keywords || []), ...((patch.keywords || []) as string[])]),
      confidence: Math.min(0.98, Math.max(persona.confidence, 0.65)),
      source: "heuristic+llm",
    };
    refined.explains = [...persona.explains, "LLM refinement applied (OpenRouter)"];
    return refined;
  } catch (e) {
    persona.explains = [...(persona.explains || []), `LLM skipped/fail: ${String(e).slice(0, 80)}`];
    return persona;
  }
}

// ---------- small utils ----------

function key(tenantId: string, domain: string) {
  return `${tenantId}:${domain}`;
}
function stamp(tenantId: string, p: SupplierPersona): StoredPersona {
  return { ...p, tenantId, updatedAt: new Date().toISOString() };
}
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
