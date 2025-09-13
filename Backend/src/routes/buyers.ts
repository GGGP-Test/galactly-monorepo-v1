// src/routes/buyers.ts
// A self-diagnosing buyers route that ALWAYS returns an explaining JSON.
// No more guesswork: every response includes traceId, timings, blockers, env flags, and notes.

import type { Express, Request, Response } from "express";
import crypto from "crypto";

// ---------- tiny utils ----------
const TRACE = () => crypto.randomBytes(8).toString("hex");
const now = () => Date.now();
const ms = (t0: number) => Math.max(0, now() - t0);

function normDomain(input?: string) {
  if (!input) return "";
  try {
    let s = input.trim().toLowerCase();
    if (s.startsWith("http://") || s.startsWith("https://")) s = new URL(s).hostname;
    return s.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function okOrigin(req: Request) {
  const allow = process.env.FRONTEND_ORIGIN?.trim();
  if (!allow) return true; // permissive by default (Northflank demo)
  return req.headers.origin === allow;
}

// redacted env snapshot for debug
function envFlags() {
  const f = (v?: string) => (v ? "set" : "unset");
  return {
    ALLOW_NET: process.env.ALLOW_NET === "1" || process.env.ALLOW_NET === "true",
    OPENROUTER_KEY: f(process.env.OPENROUTER_API_KEY),
    GOOGLE_CSE: f(process.env.GOOGLE_CSE_ID) + "/" + f(process.env.GOOGLE_CSE_KEY),
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "(any)",
    NODE_ENV: process.env.NODE_ENV || "development",
    PROVIDER: process.env.BUYERS_PROVIDER || "shim",
  };
}

// a safe 200 JSON writer (never throws)
function reply(res: Response, body: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // CORS: respect configured origin or fallback to request Origin (for GitHub Pages)
  const origin = process.env.FRONTEND_ORIGIN || (res.req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.status(200).send(JSON.stringify(body));
}

// ---------- discovery shim (no external calls) ----------
type Persona = { offer?: string; solves?: string; titles?: string };
type ReqBody = {
  supplier?: string;
  region?: string;       // "usca"
  radiusMi?: number;     // e.g. 50
  persona?: Persona;
  onlyUSCA?: boolean;
};

type Step = { name: string; ms: number; note?: string };
type Explain = {
  ok: boolean;
  traceId: string;
  supplier: { domain: string; region: string; radiusMi: number };
  created: number;
  hot: number;
  warm: number;
  candidates: any[];
  message: string;
  blockedBy?: string[];
  durationMs: number;
  debug?: {
    env: ReturnType<typeof envFlags>;
    inputs: any;
    steps: Step[];
    logs: string[];
    error?: { message: string; where?: string };
  };
};

// Synthetic candidates to verify wiring without the internet/providers.
// This helps keep everything "green" while still giving you signal.
function synthCandidates(domain: string) {
  const presets: Record<string, any[]> = {
    "peekpackaging.com": [
      { host: "shiphero.com", why: "3PL, packaging buyers", temp: "warm" },
      { host: "flowspace.com", why: "Multi-node fulfillment", temp: "warm" },
    ],
    "stretchandshrink.com": [
      { host: "xpo.com", why: "High pallet velocity", temp: "warm" },
      { host: "rrd.com", why: "Kitting & irregular loads", temp: "warm" },
    ],
  };
  return presets[domain] || [];
}

// ---------- main mount ----------
export default function mountBuyers(app: Express) {
  // OPTIONS (CORS preflight)
  app.options("/api/v1/leads/find-buyers", (_req, res) => reply(res, { ok: true }));

  app.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
    const t0 = now();
    const traceId = TRACE();
    const steps: Step[] = [];
    const logs: string[] = [];
    const env = envFlags();

    // helper to time steps
    const step = async <T>(name: string, fn: () => Promise<T> | T, note?: string): Promise<T> => {
      const s0 = now();
      try {
        const out = await fn();
        steps.push({ name, ms: ms(s0), note });
        return out;
      } catch (e: any) {
        steps.push({ name, ms: ms(s0), note: `ERR: ${e?.message || e}` });
        throw e;
      }
    };

    try {
      const body: ReqBody = (req.body || {}) as any;
      const inputInfo = { body, origin: req.headers.origin, apiKeySeen: !!req.headers["x-api-key"] };

      const normalized = await step("normalize-input", () => {
        const domain = normDomain(body.supplier);
        const region = (body.region || "usca").toLowerCase();
        const radiusMi = Math.max(1, Math.min(500, Number(body.radiusMi || 50)));
        const persona: Persona = {
          offer: (body.persona?.offer || "").trim(),
          solves: (body.persona?.solves || "").trim(),
          titles: (body.persona?.titles || "").trim(),
        };
        return { domain, region, radiusMi, persona };
      });

      const blockers: string[] = [];

      await step("validate", () => {
        if (!okOrigin(req)) blockers.push("BAD_ORIGIN");
        if (!normalized.domain) blockers.push("MISSING_DOMAIN");
        // If we require network/providers for real discovery, mark blockers here:
        if (!env.ALLOW_NET) blockers.push("NET_DISABLED");
        if (env.PROVIDER === "openrouter" && env.OPENROUTER_KEY === "unset") blockers.push("NO_OPENROUTER_KEY");
        return true;
      });

      // If blocked, return an explanatory 200 with zero candidates.
      if (blockers.length) {
        return reply(res, <Explain>{
          ok: true,
          traceId,
          supplier: {
            domain: normalized.domain,
            region: normalized.region,
            radiusMi: normalized.radiusMi,
          },
          created: 0,
          hot: 0,
          warm: 0,
          candidates: [],
          message:
            "Created 0 candidate(s). Hot:0 Warm:0. (Either no matches or discovery was blocked.)",
          blockedBy: blockers,
          durationMs: ms(t0),
          debug: { env, inputs: inputInfo, steps, logs },
        });
      }

      // PLAN
      const plan = await step("plan-discovery", () => {
        // In a future iteration we can branch to web, directories, ads, etc.
        // For now: if PROVIDER is "shim", we use synthCandidates to prove the flow end-to-end.
        return { provider: env.PROVIDER };
      });

      // DISCOVER
      const found = await step("discover", async () => {
        if (plan.provider === "shim") {
          const arr = synthCandidates(normalized.domain);
          logs.push(`shim: ${arr.length} synthetic candidates for ${normalized.domain}`);
          return arr;
        }
        // If you flip PROVIDER later, this is where you'd call real discovery.
        return [];
      });

      // SCORE + CLASSIFY
      const scored = await step("score", () =>
        found.map((c) => ({
          ...c,
          title: c.title || "Prospect @ " + c.host,
          temp: c.temp || "warm",
        }))
      );

      // (Optional) UPSERT into a store — best-effort, never blocking success
      await step("upsert", async () => {
        try {
          // dynamic import to avoid hard dependency if store wiring changes
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          const mod = await import("../data/bleed-store");
          const store = new mod.MemoryBleedStore();
          for (const c of scored) {
            await store.upsertLead({
              tenantId: "demo",
              source: "buyers:shim",
              company: c.host,
              domain: c.host,
              signals: { shim: 1 },
              scores: { intent: c.temp === "hot" ? 0.9 : 0.6 },
            });
          }
        } catch (e: any) {
          logs.push("store upsert skipped: " + (e?.message || e));
        }
      });

      const hot = scored.filter((x) => x.temp === "hot").length;
      const warm = scored.filter((x) => x.temp !== "hot").length;

      return reply(res, <Explain>{
        ok: true,
        traceId,
        supplier: {
          domain: normalized.domain,
          region: normalized.region,
          radiusMi: normalized.radiusMi,
        },
        created: scored.length,
        hot,
        warm,
        candidates: scored,
        message: `Created ${scored.length} candidate(s). Hot:${hot} Warm:${warm}.`,
        durationMs: ms(t0),
        debug: { env, inputs: inputInfo, steps, logs },
      });
    } catch (err: any) {
      // Never 500: report as ok:false with error + where, still 200 status.
      const body: Explain = {
        ok: false,
        traceId,
        supplier: { domain: "", region: "usca", radiusMi: 50 },
        created: 0,
        hot: 0,
        warm: 0,
        candidates: [],
        message: "Buyers pipeline failed safely.",
        durationMs: ms(t0),
        debug: {
          env: envFlags(),
          inputs: { note: "see request body in server logs only" },
          steps: [],
          logs: [],
          error: { message: err?.message || String(err), where: "buyers.route" },
        },
      };
      return reply(res, body);
    }
  });

  // -------- simple diagnostics you can hit from the browser --------
  app.get("/__diag/healthz", (_req, res) => reply(res, { ok: true, ts: Date.now() }));
  app.get("/__diag/envz", (req, res) => {
    const env = envFlags();
    // limit exposure to the configured origin (or allow all if not set)
    if (!okOrigin(req)) return reply(res, { ok: false, error: "BAD_ORIGIN" });
    reply(res, { ok: true, env });
  });
}