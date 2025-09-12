// routes/find.ts
import type { Application, Request, Response } from "express";
import { Router } from "express";
import { inferPersona, type Persona } from "../ai/persona-engine";

type Region = "US/CA" | "US" | "CA" | "EU" | "UK" | "ANY";
interface FindBuyersBody {
  domain?: string;
  region?: Region;
  radiusMi?: number;
  hints?: string[];
  snapshotHTML?: string;
}

const ALLOWED_HEADERS = "Content-Type, x-api-key";
const ALLOWED_METHODS = "GET, POST, OPTIONS";
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function cors(_req: Request, res: Response) {
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
  try { if (/^https?:\/\//i.test(s)) s = new URL(s).hostname; } catch {}
  s = s.replace(/^www\./i, "").replace(/[:\/].*$/, "");
  if (!HOST_RE.test(s)) return null;
  return s.toLowerCase();
}

export default function mountFind(app: Application) {
  const r = Router();
  app.use("/api/v1", r);

  r.options("/leads/find-buyers", (req, res) => { cors(req, res); return res.sendStatus(204); });

  r.post("/leads/find-buyers", expressJsonIfNeeded, async (req: Request, res: Response) => {
    cors(req, res);

    const apiKey = String(req.header("x-api-key") || "").trim();
    const tenantId = apiKey || "anon";

    const body: FindBuyersBody = (req.body ?? {}) as any;
    const domain = normalizeHost(body.domain || "");
    if (!domain) return bad(res, "domain is required");

    const region = (body.region || "US/CA") as Region;
    const radiusMi = Number.isFinite(body.radiusMi) ? Number(body.radiusMi) : 50;

    let persona: Persona;
    try {
      persona = await inferPersona({
        tenantId,
        domain,
        region,
        allowLLM: true,
        snapshotHTML: body.snapshotHTML,
        extraHints: Array.isArray(body.hints) ? body.hints.slice(0, 12) : []
      });
    } catch (e: any) {
      return bad(res, `persona build failed: ${e?.message || "unknown"}`, 500);
    }

    const topMetrics = persona.metrics.slice(0, Math.min(3, persona.metrics.length));
    const termBag = persona.terms.slice(0, 18);

    const queries = topMetrics.map((m) => ({
      metric: { key: m.key, label: m.label, weight: m.weight, reason: m.reason },
      query: buildQueryForMetric(m.key, termBag, region, radiusMi)
    }));

    const summary = { created: 0, hot: countHot(topMetrics), warm: countWarm(topMetrics) };

    return res.status(200).json({
      ok: true,
      domain,
      region,
      radiusMi,
      summary,
      plan: { queries, topTerms: termBag, metrics: topMetrics },
      explain: {
        why: topMetrics.map((m) => `${m.label}: ${m.reason}`),
        snapshot: { chars: persona.provenance.snapshotChars, sources: persona.provenance.sources },
        llmUsed: persona.provenance.llmUsed
      }
    });
  });
}

function buildQueryForMetric(key: string, terms: string[], region: Region, radiusMi: number) {
  const base: string[] = [];
  switch (key) {
    case "DCS": base.push("3pl","fulfillment","distribution center","warehouse"); break;
    case "ILL": base.push("mixed pallet","irregular loads","heterogeneous case"); break;
    case "RPI": base.push("dim weight","right-size packaging","cartonization"); break;
    case "CCI": base.push("cold chain","insulated shipper","refrigerated"); break;
    case "AUTO": base.push("automation","palletizer","pre-stretch wrapper"); break;
    case "SUS": base.push("recycled content","epr compliance","lightweighting"); break;
    case "FEI": base.push("ista","fragile goods","shock protection"); break;
    case "LABEL": base.push("labeling","thermal transfer","print and apply"); break;
    case "FOOD": base.push("beverage plant","canning line","bottling"); break;
    case "PHARMA": base.push("iso 13485","cleanroom","gmp"); break;
    default: base.push("packaging buyer","operations manager");
  }
  const extra = terms.slice(0, 4);
  const q = Array.from(new Set([...base, ...extra])).join(" | ");
  return { text: q, region, radiusMi };
}
function countHot(ms: { weight: number }[]) { return ms.filter(m => m.weight >= 0.6).length; }
function countWarm(ms: { weight: number }[]) { return ms.filter(m => m.weight > 0.25 && m.weight < 0.6).length; }

function expressJsonIfNeeded(req: Request, _res: Response, next: Function) {
  if (typeof req.body === "object" && req.body !== null) return next();
  let data = ""; req.setEncoding("utf8");
  req.on("data", (c) => (data += c));
  req.on("end", () => { try { req.body = data ? JSON.parse(data) : {}; } catch { req.body = {}; } next(); });
}
