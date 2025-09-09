// Minimal Presence router (no DB)
import { Router } from 'express';

export const router = Router();

router.get('/presence', (_req, res) => {
  res.json({
    ok: true,
    service: 'backend',
    time: new Date().toISOString(),
  });
});

export default router;
