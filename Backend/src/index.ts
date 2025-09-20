// src/index.ts
import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

// Simple healthcheck
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- Leads list used by the left table (warm/hot feed) ----
// The panel calls /api/v1/leads?temp=warm&region=usca
app.get(["/api/v1/leads", "/leads"], (req, res) => {
  const temp = String(req.query.temp ?? "warm");
  const now = new Date().toISOString();

  // Minimal rows matching the panel’s columns
  const rows = Array.from({ length: 20 }).map((_, i) => ({
    id: i + 1,
    host: `example${i + 1}.com`,
    platform: "news",
    title: ["Purchasing Manager", "Procurement Lead", "Buyer", "Head of Ops", "Sourcing Manager"][i % 5],
    created: now,
    temp,                       // "warm" | "hot"
    why: "seed"                 // short human-readable reason
  }));

  res.json({ ok: true, rows });
});

// ---- Find buyers action (right-side button) ----
// The panel sometimes calls POST /find-buyers (CORS preflight 204)
// so we answer on both /api/v1/find-buyers and /find-buyers with GET or POST.
type FindBuyersQuery = {
  supplier?: string;   // e.g., "peekpackaging.com"
  region?: string;     // e.g., "US/CA"
  radiusMi?: string;   // e.g., "50"
};

function mockCandidates(supplier: string) {
  const now = new Date().toISOString();
  return Array.from({ length: 20 }).map((_, i) => ({
    id: i + 1,
    host: `${supplier.replace(/\W+/g, "")}-cand${i + 1}.com`,
    platform: "news",
    title: ["Purchasing Manager", "Procurement Lead", "Buyer", "Head of Ops", "Sourcing Manager"][i % 5],
    created: now,
    temp: "warm",
    why: "nearby persona match"
  }));
}

function handleFindBuyers(input: { supplier?: string; region?: string; radiusMi?: number }, res: express.Response) {
  const supplier = input.supplier || "peekpackaging.com";
  const out = mockCandidates(supplier);
  // Shape is simple: a list plus quick counts so the UI can render immediately
  res.json({ ok: true, candidates: out, hot: 0, warm: out.length });
}

app.post(["/api/v1/find-buyers", "/find-buyers"], (req, res) => {
  handleFindBuyers(
    {
      supplier: req.body?.supplier || req.body?.supplierDomain || req.body?.domain,
      region: req.body?.region || req.body?.country,
      radiusMi: Number(req.body?.radiusMi ?? 50)
    },
    res
  );
});

app.get(["/api/v1/find-buyers", "/find-buyers"], (req, res) => {
  const q = req.query as FindBuyersQuery;
  handleFindBuyers(
    {
      supplier: q.supplier,
      region: q.region,
      radiusMi: Number(q.radiusMi ?? 50)
    },
    res
  );
});

// Fallback 404 (so we see clear errors instead of “pending”)
app.use((_req, res) => res.status(404).json({ error: "NOT_FOUND" }));

const port = process.env.PORT || 8787;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[buyers-api] listening on :${port}`);
});

export default app;