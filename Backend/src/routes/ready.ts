import { Router } from 'express';

const router = Router();

router.get('/readyz', (_req, res) => {
  // Later: check DB/Redis/etc. For now we are always ready when process is alive.
  res.json({ ok: true, ready: true, time: new Date().toISOString() });
});

router.get('/version', (_req, res) => {
  const ver = process.env.BUILD_SHA || process.env.SOURCE_VERSION || 'dev';
  res.json({ ok: true, version: ver });
});

export default router;
