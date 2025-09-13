// src/routes/public.ts
import type { Request, Response } from "express";
import { Router } from "express";

/**
 * Public, lenient endpoints used by the free panel.
 * Defensive: do not assume the host has .use()/.delete().
 */
export default function mountPublic(host: unknown) {
  const r = Router();

  // ---- health ----
  r.get("/healthz", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

  // ---- leads list (hot/warm) ----
  r.get("/leads", (req: Request, res: Response) => {
    const temp = String(req.query.temp || "warm");
    const region = String(req.query.region || "usca");
    const payload = { ok: true, items: [] as any[], count: 0 };
    // best-effort log for panel visibility
    try {
      console.log(`[public] GET /leads -> 200 temp=${temp} region=${region} count=${payload.count}`);
    } catch {}
    res.status(200).json(payload);
  });

  // ---- optional purge (no-op; keep POST to avoid .delete()) ----
  r.post("/leads/_purge", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, purged: 0 });
  });

  // ---- safe stub for /leads/find-buyers so panel never hard-fails ----
  // The real buyers route (./routes/buyers) will take precedence if mounted earlier/specific.
  r.post("/leads/find-buyers", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, created: 0, hot: 0, warm: 0, note: "public stub" });
  });

  // ---- mount defensively ----
  const hasUse =
    host && typeof (host as any).use === "function"; // Express app or Router
  if (hasUse) {
    (host as any).use("/api/v1", r);
  } else {
    // No .use(): return the router so the caller *could* mount it,
    // but never throw here — crashing would hide other routes.
    try {
      console.warn("[routes] public: host has no .use(); returning router (not mounted).");
    } catch {}
  }

  return r;
}
