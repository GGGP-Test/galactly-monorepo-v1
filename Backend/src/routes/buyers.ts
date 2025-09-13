// src/routes/buyers.ts
import { Router, Request, Response, NextFunction } from "express";

// --- tiny CORS helper (kept local so we don't depend on external middleware)
function allowCors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin || "*";
  res.header("Access-Control-Allow-Origin", origin as string);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

// --- minimal in-memory store so the panel can render lists without 404s
type Temp = "hot" | "warm";
interface PanelLead {
  id: string;
  host: string;
  platform: "web";
  title: string;
  created: number;
  temp: Temp;
  why?: string;
}
const leadsStore: PanelLead[] = []; // will stay empty until discovery is wired

const router = Router();
router.use(allowCors);

// Health check (useful for readiness probes)
router.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Panel list endpoint expected by the UI: GET /api/v1/leads?temp=warm&region=usca
router.get("/leads", (req, res) => {
  const temp = ((req.query.temp as string) || "").toLowerCase() as Temp | "";
  const region = (req.query.region as string) || "";
  // We currently ignore region; temp filter is applied if provided.
  let items = leadsStore.slice().sort((a, b) => b.created - a.created);
  if (temp === "hot" || temp === "warm") items = items.filter((x) => x.temp === temp);

  const count = items.length;
  // Optional debug log that mirrors what you've seen in logs earlier
  console.log(
    `[public] GET /leads -> 200 temp=${temp || "-"} region=${region || "-"} count=${count}`
  );

  res.status(200).json(items);
});

// Action endpoint expected by the UI: POST /api/v1/leads/find-buyers
// Body: { domain: string, region?: string, radiusMi?: number }
router.post("/leads/find-buyers", expressJsonSafe, (req, res) => {
  const { domain, region, radiusMi } = req.body || {};

  if (!domain || typeof domain !== "string" || !domain.trim()) {
    return res.status(400).json({ ok: false, error: "domain is required" });
  }

  // For now we only ACK the request so the UI flow is unblocked.
  // The next step will plug in the buyer-discovery engine and push
  // created leads into `leadsStore`.
  const created: PanelLead[] = [];
  console.log(
    `[buyers] find-buyers accepted domain=${domain} region=${region || "-"} radius=${radiusMi || "-"}`
  );

  return res.status(200).json({
    ok: true,
    created,
    hot: created.filter((x) => x.temp === "hot").length,
    warm: created.filter((x) => x.temp === "warm").length,
  });
});

// --- local JSON body parser with error guard (avoids raw-body explosions)
function expressJsonSafe(req: Request, res: Response, next: NextFunction) {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (!raw) {
      req.body = {};
      return next();
    }
    try {
      req.body = JSON.parse(raw);
      next();
    } catch (e) {
      console.error("[buyers] JSON parse error:", e);
      res.status(400).json({ ok: false, error: "invalid json" });
    }
  });
}

export default router;