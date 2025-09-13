import type { Express, Request, Response } from "express";
import { Router } from "express";

/**
 * Public, lenient endpoints used by the free panel.
 * NOTE: avoid calling app.delete(...) directly; always register on a Router
 * and attach the router with app.use(...) so we don't depend on the caller's type.
 */
export default function mountPublic(app: Express) {
  const r = Router();

  // Health
  r.get("/healthz", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

  // Lists (hot / warm). Keep returning an empty list if none exist.
  r.get("/leads", (req: Request, res: Response) => {
    const temp = (req.query.temp as string) || "warm";
    const region = (req.query.region as string) || "usca";

    const payload = { ok: true, items: [] as any[], count: 0 };
    res.status(200).json(payload);

    // Best-effort log for the panel
    try {
      // eslint-disable-next-line no-console
      console.log(
        `[public] GET /leads -> 200 temp=${temp} region=${region} count=${payload.count}`
      );
    } catch {}
  });

  // Purge (admin) — use POST instead of DELETE to avoid the .delete crash.
  // Keep it a no-op for now; we just need the route mounted without killing the server.
  r.post("/leads/_purge", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, purged: 0 });
  });

  // (Optional) graceful stub so the front-end always gets a 200 even if the real
  // buyers route mounts elsewhere; this does NOT replace ./routes/buyers if present.
  r.post("/leads/find-buyers", (_req: Request, res: Response) => {
    // Return a harmless envelope so the panel doesn't explode if buyers route isn’t mounted yet.
    res.status(200).json({ ok: true, created: 0, hot: 0, warm: 0, note: "public stub" });
  });

  // Mount everything under /api/v1 to match the panel
  app.use("/api/v1", r);
}
