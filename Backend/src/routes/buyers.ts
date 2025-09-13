// src/routes/buyers.ts
// One router that mounts:
// - POST /api/v1/leads/find-buyers  (instrumented, never throws, explains "0 created")
// - GET  /__diag/healthz            (light health)
// - GET  /__diag/envz               (redacted env snapshot for debugging)

import express, { Request, Response } from "express";
import crypto from "crypto";

// ---- Config (tweak without touching code elsewhere) -------------------------
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://gggp-test.github.io";
const ALLOW_NET = (process.env.ALLOW_NET || "false").toLowerCase() === "true"; // turn on real crawling later
const REGION_DEFAULT = "usca";

// Safe, redacted view of env so we can see feature flags quickly
function safeEnv() {
  const redact = (v?: string) => (v ? "set" : "unset");
  return {
    NODE_ENV: process.env.NODE_ENV || "",
    ALLOW_NET,
    FRONTEND_ORIGIN,
    OPENROUTER_API_KEY: redact(process.env.OPENROUTER_API_KEY),
    OPAL_API_KEY: redact(process.env.OPAL_API_KEY),
  };
}

// Common JSON sender that always 200s and never leaks stack to strangers
function sendJson(req: Request, res: Response, payload: any) {
  const origin = req.headers.origin || "";
  // Only include the deep debug object to our panel origin (so you can paste it to me)
  const includeDebug = typeof origin === "string" && origin.startsWith(FRONTEND_ORIGIN);
  const { debug, ...rest } = payload || {};
  res.status(200).json(includeDebug ? payload : rest);
}

// Parse & normalize body from panel
function parseBody(body: any) {
  const out = {
    supplier: (body?.supplier || body?.domain || "").toString().trim().toLowerCase(),
    region: (body?.region || REGION_DEFAULT).toString().trim().toLowerCase(),
    radiusMi: Number(body?.radiusMi || 50) || 50,
    persona: {
      offer: (body?.persona?.offer || "").toString().trim(),
      solves: (body?.persona?.solves || "").toString().trim(),
      titles: (body?.persona?.titles || "").toString().trim(),
    },
  };
  // normalize supplier -> domain
  if (out.supplier.startsWith("http")) {
    try {
      const u = new URL(out.supplier);
      out.supplier = u.hostname.replace(/^www\./, "");
    } catch {/* ignore */}
  }
  out.supplier = out.supplier.replace(/^www\./, "");
  return out;
}

// Very-light heuristic seed generator (so you can see non-zero candidates even with ALLOW_NET=false)
function heuristicSeeds(domain: string) {
  const d = domain || "";
  const isPack = /packag/i.test(d);
  const isFilm = /film|stretch|shrink/i.test(d);
  const out: any[] = [];

  if (isPack || isFilm) {
    out.push(
      { host: "example-3pl.com", title: "Prospect • 3PL", why: "Warehouse ops likely buying stretch film", temp: "warm" },
      { host: "regional-fulfillment.net", title: "Prospect • Fulfillment", why: "Node/DC ops → pallet wrap consumption", temp: "warm" },
      { host: "fast-grocery-shipper.org", title: "Prospect • Grocery shipper", why: "Mixed-load shipping → wrap savings", temp: "warm" },
    );
  }
  return out;
}

// The “discovery” placeholder. When ALLOW_NET=false we don’t crawl; we only return heuristic seeds.
// When ALLOW_NET=true you’ll wire real crawlers. Either way we always resolve.
async function discoverBuyers(domain: string, region: string, radiusMi: number, persona: any) {
  const candidates: any[] = [];

  // Heuristic fallback (always safe)
  candidates.push(...heuristicSeeds(domain));

  // Future: if (ALLOW_NET) { …real web ops… }
  const notes: string[] = [];
  if (!ALLOW_NET) notes.push("net_disabled");

  // Persona influence (soft)
  const personaEmpty = !persona?.offer && !persona?.solves && !persona?.titles;
  if (personaEmpty) notes.push("persona_empty");

  return { candidates, notes };
}

// Wrap handler in try/catch and convert any throw into { ok:false, error }
function safeHandler(fn: (req: Request, res: Response) => Promise<void> | void) {
  return async (req: Request, res: Response) => {
    const t0 = Date.now();
    const traceId = crypto.randomBytes(8).toString("hex");
    try {
      await Promise.resolve(fn(req, res));
    } catch (err: any) {
      const durationMs = Date.now() - t0;
      sendJson(req, res, {
        ok: false,
        error: "internal_error",
        message: "The server caught an unexpected error. See debug for details.",
        blockedBy: "exception",
        traceId,
        durationMs,
        debug: {
          err: { name: err?.name, msg: err?.message },
          stack: (err?.stack || "").split("\n").slice(0, 6),
          seenBody: req.body,
          env: safeEnv(),
        },
      });
    }
  };
}

export default function mountBuyers(app: express.Express) {
  const router = express.Router();

  // --- main endpoint ---------------------------------------------------------
  router.post("/api/v1/leads/find-buyers", safeHandler(async (req, res) => {
    const t0 = Date.now();
    const traceId = crypto.randomBytes(8).toString("hex");

    // Ensure JSON is parsed (otherwise body is empty and we’d get the old “domain is required”)
    // Your index should have: app.use(express.json({ limit: '512kb' }));
    const { supplier, region, radiusMi, persona } = parseBody(req.body);

    // Validation & explicit reasons (no more mysterious 0)
    const reasons: string[] = [];
    if (!supplier) reasons.push("domain_missing");
    if (!region) reasons.push("region_missing");
    if (reasons.length) {
      return sendJson(req, res, {
        ok: false,
        error: "bad_request",
        message: "Missing required fields.",
        blockedBy: reasons.join("|"),
        traceId,
        durationMs: Date.now() - t0,
        debug: { seenBody: req.body, parsed: { supplier, region, radiusMi, persona }, env: safeEnv() },
      });
    }

    // Run “discovery” (non-throwing)
    const { candidates, notes } = await discoverBuyers(supplier, region, radiusMi, persona);

    const created = candidates.length;
    const payload = {
      ok: created > 0,
      supplier: { domain: supplier, region, radiusMi },
      created,
      hot: 0,
      warm: created, // simple for now
      candidates,
      message:
        created > 0
          ? `Created ${created} candidate(s).`
          : "Created 0 candidate(s). Hot:0 Warm:0.",
      blockedBy: created > 0 ? "" : (notes.length ? notes.join("|") : "no_matches"),
      traceId,
      durationMs: Date.now() - t0,
      debug: {
        notes,
        personaEmpty: !persona?.offer && !persona?.solves && !persona?.titles,
        parsed: { supplier, region, radiusMi, persona },
        env: safeEnv(),
        timing: { t0 },
      },
    };

    return sendJson(req, res, payload);
  }));

  // --- light diagnostics -----------------------------------------------------
  router.get("/__diag/healthz", (req, res) => {
    res.status(200).json({
      ok: true,
      service: "buyers",
      time: new Date().toISOString(),
    });
  });

  router.get("/__diag/envz", (req, res) => {
    sendJson(req, res, { ok: true, env: safeEnv() });
  });

  app.use(router);
  console.log("[routes] mounted buyers from ./routes/buyers");
}