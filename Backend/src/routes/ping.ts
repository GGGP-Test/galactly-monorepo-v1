// src/routes/ping.ts
// Simple health endpoint so /api/ping returns 200 for the free panel.

import { Router, Request, Response } from "express";
import { CFG } from "../shared/env";

const r = Router();

/**
 * GET /api/ping
 * Always returns 200 with a tiny payload; never throws.
 */
r.get("/", (_req: Request, res: Response) => {
  try {
    res.json({
      ok: true,
      name: "galactly-api",
      env: {
        node: process.versions.node,
        port: CFG?.port ?? undefined,
      },
      time: new Date().toISOString(),
      routes: {
        prefs: "/api/prefs/ping",
        leads: "/api/leads/find-buyers",
        inbound: "/api/inbound/ping",
      },
    });
  } catch {
    // Even on unexpected error, respond 200 with ok:false
    res.json({ ok: false });
  }
});

export default r;