// src/index.ts
import express, { Request, Response, NextFunction } from "express";

// ---------- tiny helpers ----------
const PORT = Number(process.env.PORT || 8787);

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
const leadsStore: PanelLead[] = []; // will be populated by real discovery later

function cors(req: Request, res: Response, next: NextFunction) {
  const origin = (req.headers.origin as string) || "*";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

// Guarded JSON parser (prevents raw-body/esbuild crashes on bad JSON)
function jsonSafe(req: Request, res: Response, next: NextFunction) {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (!raw) {
      req.body = {};
      return next();
    }
    try {
      req.body = JSON.parse(raw);
      next();
    } catch (e) {
      console.error("[json] parse error", e);
      res.status(400).json({ ok: false, error: "invalid json" });
    }
  });
}

// ---------- app ----------
const app = express();
app.disable("x-powered-by");
app.use(cors);

// Health/readiness for your probe
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ---------- PANEL API the UI expects ----------
// GET /api/v1/leads?temp=warm&region=usca
app.get("/api/v1/leads", (req, res) => {
  const tempQ = (req.query.temp as string | undefined)?.toLowerCase() as Temp | undefined;
  const region = (req.query.region as string | undefined) || "-";
  let items = leadsStore.slice().sort((a, b) => b.created - a.created);
  if (tempQ === "hot" || tempQ === "warm") items = items.filter((x) => x.temp === tempQ);

  console.log(`[public] GET /leads -> 200 temp=${tempQ || "-"} region=${region} count=${items.length}`);
  res.status(200).json(items);
});

// POST /api/v1/leads/find-buyers
// body: { domain: string, region?: string, radiusMi?: number }
app.post("/api/v1/leads/find-buyers", jsonSafe, (req, res) => {
  const { domain, region, radiusMi } = req.body || {};
  if (!domain || typeof domain !== "string" || !domain.trim()) {
    return res.status(400).json({ ok: false, error: "domain is required" });
  }

  console.log(
    `[buyers] find-buyers accepted domain=${domain} region=${region || "-"} radius=${radiusMi || "-"}`
  );

  // Stub: no discovery yet; just respond 200 so the panel flow is unblocked.
  const created: PanelLead[] = [];
  res.status(200).json({
    ok: true,
    created,
    hot: created.filter((x) => x.temp === "hot").length,
    warm: created.filter((x) => x.temp === "warm").length,
  });
});

// Fallback for unknown routes (helps debugging)
app.use((req, res) => {
  res
    .status(404)
    .type("text")
    .send(`Not Found: ${req.method} ${req.originalUrl}`);
});

// ---------- boot ----------
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});