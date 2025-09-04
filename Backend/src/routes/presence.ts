// Backend/src/routes/SourceRoutePresence.ts
import { Router } from 'express';

export const router = Router();

const beats = new Map<string, number>();

router.get('/presence/online', (req, res) => {
  const uid = String(req.header('x-galactly-user') || 'u-anon');
  beats.set(uid, Date.now());

  // prune very old beats (> 2 minutes)
  const now = Date.now();
  for (const [k, v] of beats.entries()) {
    if (now - v > 120_000) beats.delete(k);
  }

  res.json({ ok: true, total: beats.size });
});

router.get('/presence/beat', (req, res) => {
  const uid = String(req.header('x-galactly-user') || 'u-anon');
  beats.set(uid, Date.now());
  res.json({ ok: true });
});

export default router;
