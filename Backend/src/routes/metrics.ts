import { Router } from 'express';

const router = Router();
let started = Date.now();
let reqs = 0;

router.use((_req, _res, next) => {
  reqs++;
  next();
});

router.get('/metrics', (_req, res) => {
  const up = Math.floor((Date.now() - started) / 1000);
  res.type('text/plain').send(
    [
      `service_uptime_seconds ${up}`,
      `service_requests_total ${reqs}`,
      `service_node_env{env="${process.env.NODE_ENV || 'dev'}"} 1`,
    ].join('\n')
  );
});

export default router;
