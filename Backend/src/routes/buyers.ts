// src/routes/buyers.ts
import type { Express, Request, Response } from "express";
import { Router } from "express";

// ————— helpers —————
function sanitizeDomain(input?: unknown): string {
  if (!input) return "";
  let s = String(Array.isArray(input) ? input[0] : input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : "";
}

function safeBody(req: Request): Record<string, unknown> {
  const b = (req as any).body;
  if (b && typeof b === "object") return b as Record<string, unknown>;
  if (typeof b === "string" && b.trim()) {
    try { return JSON.parse(b); } catch { /* ignore */ }
  }
  return {};
}

function extractDomain(req: Request): string {
  const b = safeBody(req);
  const q = req.query as Record<string, unknown>;
  const candidates = [
    b.domain, b.host, b.hostname, b.website, b.supplier, (b as any).supplierDomain,
    q.domain, q.host, q.hostname, q.website, q.supplier, (q as any).supplierDomain,
  ];
  for (const v of candidates) {
    const d = sanitizeDomain(v);
    if (d) return d;
  }
  return "";
}

// ————— router —————
export default function mountBuyers(app: Express) {
  const router = Router();

  // Extra safety: if global parsers are ever removed, keep local ones here too
  router.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "https://gggp-test.github.io");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  // POST /api/v1/leads/find-buyers
  router.post("/find-buyers", async (req: Request, res: Response) => {
    // debug breadcrumbs to verify what the server receives
    const ct = req.headers["content-type"] || "";
    const keys = Object.keys(safeBody(req));
    const domain = extractDomain(req);

    if (!domain) {
      return res.status(400).json({
        ok: false,
        error: "domain is required",
        debug: { contentType: ct, bodyKeys: keys, query: req.query },
        hint: `Send JSON {"domain":"example.com"}`,
      });
    }

    // Stub response for now; wire discovery next
    return res.json({
      ok: true,
      accepted: { domain },
      created: 0,
      counts: { hot: 0, warm: 0 },
      note: "buyers endpoint healthy; discovery not wired in this commit.",
    });
  });

  app.use("/api/v1/leads", router);
  console.log("[routes] mounted buyers from ./routes/buyers");
}
