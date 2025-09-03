// src/routes/presence.ts
import type { Request, Response } from "express";
import { Router } from "express";

/**
 * Very lightweight in-memory presence.
 * We "touch" presence both on GET /online and POST /heartbeat so
 * the UI can either poll or heartbeat. Items expire after TTL ms.
 */
export function createPresenceRouter() {
  const router = Router();

  // id -> { lastSeen, ua }
  const sessions = new Map<
    string,
    { lastSeen: number; ua: string | undefined }
  >();

  // consider someone online if we've seen them within the last TTL
  const TTL = 45_000; // 45s
  const now = () => Date.now();

  function makeId(req: Request) {
    // prefer sticky header (set by our fetch wrapper), fall back to IP
    const uid =
      req.header("x-galactly-user") ||
      (req.headers["x-forwarded-for"] as string) ||
      req.ip ||
      "anon";
    return String(uid).slice(0, 200);
  }

  function touch(req: Request) {
    const id = makeId(req);
    sessions.set(id, { lastSeen: now(), ua: req.get("user-agent") });
    return id;
  }

  function prune() {
    const cutoff = now() - TTL;
    for (const [id, s] of sessions) {
      if (s.lastSeen < cutoff) sessions.delete(id);
    }
  }

  // You can call this every ~10s from the client; or just poll /online.
  router.post("/heartbeat", (req: Request, res: Response) => {
    touch(req);
    prune();
    res.json({ ok: true });
  });

  // Polling endpoint used by the UI. Also touches presence.
  router.get("/online", (req: Request, res: Response) => {
    touch(req);
    prune();
    res.json({
      ok: true,
      total: sessions.size,
      // optional diagnostics for admins
      // nodes: [...sessions.keys()].slice(0, 10),
    });
  });

  // Optional quick debug (remove in prod if you like)
  router.get("/debug", (_req: Request, res: Response) => {
    prune();
    res.json({
      ok: true,
      total: sessions.size,
      sample: Array.from(sessions.entries())
        .slice(0, 10)
        .map(([id, s]) => ({ id, lastSeen: s.lastSeen, ua: s.ua })),
    });
  });

  // Periodic background prune to avoid leaking memory
  setInterval(prune, 15_000).unref();

  return router;
}

export default createPresenceRouter;
