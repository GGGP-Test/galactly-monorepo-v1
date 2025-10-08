// src/routes/credits.ts
//
// Simple credits/limits readout by IP and plan.
// Mount later as:  app.use("/api/credits", CreditsRouter)
//
// Reads the same daily counters used by classify/metrics preview.
// If a counter hasn't been incremented elsewhere yet, "used" will be 0.

import { Router, Request, Response } from "express";
import { CFG } from "../shared/env";
import { daily } from "../shared/guards";

export const CreditsRouter = Router();

function ipKey(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || "ip");
}

function userPlan(req: Request): "free" | "pro" | "enterprise" {
  const p = String(req.header("x-user-plan") || req.query.plan || "free").trim().toLowerCase();
  return p === "enterprise" ? "enterprise" : p === "pro" ? "pro" : "free";
}

CreditsRouter.get("/ping", (_req, res) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

CreditsRouter.get("/", (req: Request, res: Response) => {
  const plan = userPlan(req);
  const ip = ipKey(req);

  // Same caps we already use in classify/metrics preview
  const classifyLimit = Number(CFG.classifyDailyLimit || 20);
  const previewLimit  = Math.max(5, Number(CFG.classifyDailyLimit || 20));

  const classifyUsed = Number(daily.get(`classify:${ip}`) || 0);
  const previewUsed  = Number(daily.get(`metrics:${ip}`) || 0);

  // We don’t strictly cap /web/find today, but we expose a soft counter key.
  const webFindUsed = Number(daily.get(`find:${ip}`) || 0);

  res.json({
    ok: true,
    plan,
    quotas: {
      classify: {
        limit: classifyLimit,
        used: classifyUsed,
        remaining: Math.max(0, classifyLimit - classifyUsed)
      },
      preview: {
        limit: previewLimit,
        used: previewUsed,
        remaining: Math.max(0, previewLimit - previewUsed)
      },
      web_find: {
        // informational only until we decide to cap
        limit: null,
        used: webFindUsed,
        remaining: null
      }
    },
    notes: [
      "Set header x-user-plan=pro or enterprise to lift gates where supported.",
      "Counters reset daily in-memory; persistence can be added later."
    ],
    at: new Date().toISOString()
  });
});

export default CreditsRouter;