// routes/find.ts
//
// POST /api/v1/leads/find-buyers
// - Validates input (domain/region)
// - Builds a supplier persona via src/ai/persona-engine
// - Returns a compact "plan" (queries + top metrics) and a summary
//
// NOTE: This does not mutate your DB. It only returns candidates/plan.
//       Wire creation into your lead writer if/when you’re ready.

import type { Application, Request, Response } from "express";
import { Router } from "express";
import { inferPersona, type Persona } from "../ai/persona-engine";

type Region = "US/CA" | "US" | "CA" | "EU" | "UK" | "ANY";

interface FindBuyersBody {
  domain?: string;
  region?: Region;
  radiusMi?: number;
  hints?: string[];          // optional, from panel manual inputs
  snapshotHTML?: string;     // optional, if the panel passes a pre-scraped blob
}

const ALLOWED_HEADERS = "Content-Type, x-api-key";
const ALLOWED_METHODS = "GET, POST, OPTIONS";

// Cheap host check: bare host only.
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function cors(req: Request, res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
}

function bad(res: Response, msg: string, code = 400) {
  cors({} as any, res);
  return res.status(code).json({ ok: false, error: msg });
}

function normalizeHost(input: string): string | null {
  let s = (input || "").trim();
  if (!s) return null;
  // strip protocol / path
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      s = u.hostname;
    }
  } catch { /* ignore */ }
  // strip common noise
  s = s.replace(/^www\./i, "").replace(/[:\/].*$/, "");
  if (!HOST_RE.test(s)) return null;
  return s.toLowerCase();
}

export default function mountFind(app: Application) {
  const r = Router();

  // All routes in this file live under /api/v1
  app.use("/api/v1", r);

  // CORS preflight
  r.options("/leads/find-buyers", (req, res) => {
    cors(req, res);
    return res.sendStatus(204);
  });

  // Main endpoint
  r.post("/leads/find-buyers", expressJsonIfNeeded, async (req: Request, res: Response) => {
    cors(req, res);

    const apiKey = String(req.header("x-api-key") || "").trim();
    const tenantId = apiKey || "anon";

    const body: FindBuyersBody = (req.body ?? {}) as any;
    const domain = normalizeHost(body.domain || "");
    if (!domain) return bad(res, "domain is required");

    const region = (body.region || "US/CA") as Region;
    const radiusMi = Number.isFinite(body.radiusMi) ? Number(body.radiusMi) : 50;

    // Persona build (cached for 7d inside the engine)
    let persona: Persona;
    try {
      persona = await inferPersona({
        tenantId,
        domain,
        region,
        allowLLM: true,                // safe JSON mode; cheap model by default
        snapshotHTML: body.snapshotHTML,
        extraHints: Array.isArray(body.hints) ? body.hints.slice(0, 12) : []
      });
    } catch (e: any) {
      return bad(res, `persona build failed: ${e?.message || "unknown"}`, 500);
    }

    // Build a tiny “plan” of buyer queries using top metrics + terms.
    const topMetrics = persona.metrics.slice(0, Math.min(3, persona.metrics.length));
    const termBag = persona.terms.slice(0, 18);

    const queries = topMetrics.map((m) => ({
      metric: { key: m.key, label: m.label, weight: m.weight, reason: m.reason },
      // These are human-readable queries for your downstream searchers (webscout, buyers, etc.)
      // They’re NOT executed here — we just return them so the caller (or another route)
      // can decide which finder to use.
      query: buildQueryForMetric(m.key, termBag, region, radiusMi)
    }));

    // This endpoint used to create DB rows. To keep the UI happy and avoid 400s,
    // we return a “created summary” with zero mutations.
    const summary = {
      created: 0,
      hot: countHot(topMetrics),
      warm: countWarm(topMetrics)
    };

    return res.status(200).json({
      ok: true,
      domain,
      region,
      radiusMi,
      summary,
      plan: {
        queries,
        topTerms: termBag,
        metrics: topMetrics
      },
      explain: {
        why: topMetrics.map((m) => `${m.label}: ${m.reason}`),
        snapshot: {
          chars: persona.provenance.snapshotChars,
          sources: persona.provenance.sources
        },
        llmUsed: persona.provenance.llmUsed
      }
    });
  });
}

// -------- helpers --------

function buildQueryForMetric(key: string, terms: string[], region: Region, radiusMi: number) {
  const base: string[] = [];
  switch (key) {
    case "DCS":
      base.push("3pl", "fulfillment", "distribution center", "warehouse");
      break;
    case "ILL":
      base.push("mixed pallet", "irregular loads", "heterogeneous case");
      break;
    case "RPI":
      base.push("dim weight", "right-size packaging", "cartonization");
      break;
    case "CCI":
      base.push("cold chain", "insulated shipper", "refrigerated");
      break;
    case "AUTO":
      base.push("automation", "palletizer", "pre-stretch wrapper");
      break;
    case "SUS":
      base.push("recycled content", "epr compliance", "lightweighting");
      break;
    case "FEI":
      base.push("ista", "fragile goods", "shock protection");
      break;
    default:
      base.push("packaging buyer", "operations manager");
  }
  // keep query compact
  const extra = terms.slice(0, 4);
  const q = Array.from(new Set([...base, ...extra])).join(" | ");
  return { text: q, region, radiusMi };
}

function countHot(metrics: { weight: number }[]) {
  return metrics.filter(m => m.weight >= 0.6).length;
}
function countWarm(metrics: { weight: number }[]) {
  return metrics.filter(m => m.weight > 0.25 && m.weight < 0.6).length;
}

// JSON body parsing without relying on a global app.use(express.json())
function expressJsonIfNeeded(req: Request, res: Response, next: Function) {
  // If body already parsed, continue.
  if (typeof req.body === "object" && req.body !== null) return next();
  let data = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => (data += chunk));
  req.on("end", () => {
    try { req.body = data ? JSON.parse(data) : {}; } catch { req.body = {}; }
    next();
  });
}
