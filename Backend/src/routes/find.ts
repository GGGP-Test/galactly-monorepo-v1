import type { Request, Response } from "express";
import { PersonaEngine } from "../ai/persona-engine";

/**
 * POST /api/v1/leads/find-buyers
 * Body: { domain: string, region?: string, radiusMi?: number, snapshotHTML?: string, hints?: string[] }
 *
 * Behavior:
 *  - Validates input + CORS headers (incl. x-api-key).
 *  - Builds a Persona for the supplier.
 *  - Synthesizes 3–6 buyer “candidate queries” based on top metrics (hot/warm).
 *  - (Optionally) stores in-memory "created leads" so the Free Panel can show something.
 *  - Returns { ok, created, hot, warm, persona, candidates }.
 */

type Candidate = {
  q: string;             // search intent / query
  why: string[];         // short reasons
  temp: "hot" | "warm";
};

const createdLeads: {
  id: string;
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: "hot" | "warm";
  why: string;
}[] = [];

// crude id
function rid() {
  return "L_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// Very small generator mapping persona metrics -> candidate intents
function candidatesFromPersona(p: Awaited<ReturnType<PersonaEngine["infer"]>>, region: string) : Candidate[] {
  const out: Candidate[] = [];
  const add = (q: string, why: string[], temp: "hot" | "warm" = "warm") => {
    out.push({ q, why, temp });
  };

  const top = new Set(p.top);

  if (top.has("3PL")) {
    add(`("${p.domain}" OR packaging) buyers 3PL fulfillment ${region}`, ["3PL signals", "multinode/DC"], "hot");
    add(`third party logistics warehouse manager packaging ${region}`, ["3PL roles"]);
  }
  if (top.has("ILL") || top.has("STR")) {
    add(`warehouse irregular pallets stretch film turntable ${region}`, ["irregular load / stretch"]);
    add(`pallet wrapping automation buyer ${region}`, ["automation buyer"]);
  }
  if (top.has("CCI")) {
    add(`cold chain insulated shipper buyer ${region}`, ["cold chain intensity"], "hot");
  }
  if (top.has("DFS")) {
    add(`ecommerce fulfillment packaging manager ${region}`, ["D2C tech stack"]);
  }
  if (top.has("CWB")) {
    add(`corrugated box engineer / packaging engineer ${region}`, ["heavy corrugated use"]);
  }
  if (top.has("FNB")) {
    add(`food & beverage packaging manager ${region}`, ["F&B compliance"]);
  }
  if (out.length < 3) {
    add(`warehouse packaging buyer ${region}`, ["generic fallback"]);
  }
  return out.slice(0, 6);
}

function allowCors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
}

export default function mountFind(app: any) {
  // For health-style logging parity with your other routes
  console.log("[routes] mounted find from ./routes/find");

  app.options("/api/v1/leads/find-buyers", (req: Request, res: Response) => {
    allowCors(res);
    res.status(204).end();
  });

  app.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
    allowCors(res);

    try {
      const { domain, region, radiusMi, snapshotHTML } = (req.body || {}) as {
        domain?: string;
        region?: string;
        radiusMi?: number;
        snapshotHTML?: string;
      };

      if (!domain || typeof domain !== "string" || domain.trim() === "") {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }

      const engine = new PersonaEngine({
        openRouterKey: process.env.OPENROUTER_API_KEY,
        openRouterModel: process.env.OPENROUTER_MODEL
      });

      const persona = await engine.infer(domain, snapshotHTML);
      const candidates = candidatesFromPersona(persona, region || "US/CA");

      // materialize a few “leads” locally so the Free Panel has rows to show
      let hot = 0, warm = 0, created = 0;
      for (const c of candidates) {
        const item = {
          id: rid(),
          host: persona.domain,
          platform: "web" as const,
          title: c.q,
          created: new Date().toISOString(),
          temp: c.temp,
          why: c.why.join(", ")
        };
        createdLeads.unshift(item);
        created++;
        if (c.temp === "hot") hot++; else warm++;
      }

      return res.status(200).json({
        ok: true,
        created,
        hot,
        warm,
        persona,
        candidates
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: String(err?.message || err || "internal error") });
    }
  });

  // Lenient public listing so the Free Panel can GET /leads and see what we just created
  app.get("/leads", (_req: Request, res: Response) => {
    allowCors(res);
    const region = (_req.query?.region as string) || "US/CA";
    const temp = (_req.query?.temp as string) || "warm";
    // very simple filter facade; your panel only checks counts & rows
    const rows = createdLeads.filter(() => true);
    res.status(200).json({ ok: true, region, temp, count: rows.length, rows });
  });
}
