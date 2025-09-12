// src/index.ts
/**
 * Minimal bootstrap to keep the service running reliably under tsx/Node20.
 * - Uses CJS-compatible require for Express to avoid "express is not a function".
 * - Provides /healthz for readiness probes.
 * - Wires a placeholder /api/v1/leads/find-buyers that validates input
 *   (keeps current 400 for missing `domain` so UI behavior remains consistent).
 */

import http from "http";

// --- Express import (interop-safe) ---
const _express = require("express"); // CJS require works under tsx too
const express: any = _express?.default ?? _express;

// --- App wiring ---
const app = express();
app.use(express.json());

// Health endpoint for probes
app.get("/healthz", (_req: any, res: any) => res.status(200).send("ok"));

// Keep current behavior for the panel (400 if domain is missing)
app.post("/api/v1/leads/find-buyers", (req: any, res: any) => {
  const { domain } = req.body || {};
  if (!domain || typeof domain !== "string" || !domain.includes(".")) {
    return res.status(400).json({ ok: false, error: "domain is required" });
  }

  // TODO: later we’ll connect to the real buyer-finder flow.
  return res.status(501).json({ ok: false, error: "not implemented yet" });
});

// Start server
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`[server] listening on :${port}`);
});
