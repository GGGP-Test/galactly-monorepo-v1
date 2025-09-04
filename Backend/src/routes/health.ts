import { Router } from 'express';

export const router = Router();

/** counters/status used by header */
router.get('/status', (req, res) => {
  const devUnlimited = !!process.env.DEV_UNLIMITED || false;
  res.json({
    ok: true,
    uid: String(req.header('x-galactly-user') || 'u-anon'),
    plan: 'free',
    quota: {
      date: new Date().toISOString().slice(0, 10),
      findsUsed: 0,
      revealsUsed: 0,
      findsLeft: devUnlimited ? 9999 : 99,
      revealsLeft: devUnlimited ? 9999 : 5,
    },
    devUnlimited,
  });
});
