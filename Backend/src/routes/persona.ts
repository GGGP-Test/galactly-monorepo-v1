// routes/persona.ts
// GET /api/v1/persona?domain=acme.com  -> returns current cached persona (builds if absent)
import type { Application, Request, Response } from "express";
import { Router } from "express";
import { inferPersona } from "../ai/persona-engine";

export default function mountPersona(app: Application) {
  const r = Router();
  const ALLOWED_HEADERS = "Content-Type, x-api-key";
  const ALLOWED_METHODS = "GET, OPTIONS";

  function cors(_req: Request, res: Response) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  }

  app.use("/api/v1", r);

  r.options("/persona", (req, res) => { cors(req, res); return res.sendStatus(204); });

  r.get("/persona", async (req: Request, res: Response) => {
    cors(req, res);
    const domain = String(req.query.domain || "").trim();
    if (!domain) return res.status(400).json({ ok:false, error: "domain is required" });
    const apiKey = String(req.header("x-api-key") || "").trim();
    const tenantId = apiKey || "anon";
    try {
      const p = await inferPersona({ tenantId, domain, region: "ANY", allowLLM: true });
      return res.status(200).json({ ok:true, persona: p });
    } catch (e: any) {
      return res.status(500).json({ ok:false, error: e?.message || "persona failed" });
    }
  });
}
