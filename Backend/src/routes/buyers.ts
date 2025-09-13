// src/routes/buyers.ts
import type { Express, Request, Response } from "express";
import express, { Router } from "express";

/** Normalize domain: strip scheme, www, paths; validate looks like a host */
function sanitizeDomain(input?: unknown): string {
  if (!input) return "";
  let s = String(Array.isArray(input) ? input[0] : input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  // simple host check: a.b / a.b.c with TLD 2+ chars
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : "";
}

/** Try to read body in every shape (JSON, urlencoded, raw string) */
function safeBody(req: Request): Record<string, unknown> {
  const b = (req as any).body;
  if (b && typeof b === "object") return b as Record<string, unknown>;
  if (typeof b === "string" && b.trim()) {
    try {
      return JSON.parse(b);
    } catch {
      try {
        const m = Object.fromEntries(new URLSearchParams(b));
        return m;
      } catch {
        /* ignore */
      }
    }
  }
  return {};
}

/** Accept domain from body or query, across common key names */
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

export default function mountBuyers(app: Express) {
  const router = Router();

  // CORS (restrict origin if you like via env)
  router.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "https://gggp-test.github.io");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  // Body parsers for this router (kept local so it can’t be missed)
  router.use(express.json({ limit: "1mb", strict: false }));
  router.use(express.urlencoded({ extended: true }));

  /**
   * POST /api/v1/leads/find-buyers
   * Body: { domain: "example.com", region?, radiusMi?, persona? }
   * Also accepts { host|website|supplier|supplierDomain } or same via querystring.
   */
  router.post("/find-buyers", async (req: Request, res: Response) => {
    const domain = extractDomain(req);

    if (!domain) {
      // Echo a little context to help debugging from the panel
      return res.status(400).json({
        ok: false,
        error: "domain is required",
        receivedKeys: Object.keys(safeBody(req)),
        hint: `Send JSON like {"domain":"example.com"}`,
      });
    }

    // ——— Stub response for now; actual discovery will fill these ———
    // You can later plug in buyer-discovery and BLEED store here.
    return res.json({
      ok: true,
      accepted: { domain },
      created: 0,
      counts: { hot: 0, warm: 0 },
      note: "Endpoint healthy; discovery not wired in this commit.",
    });
  });

  app.use("/api/v1/leads", router);
  console.log("[routes] mounted buyers from ./routes/buyers");
}