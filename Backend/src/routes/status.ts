import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Simple helper to read a boolean env
 */
function flag(name: string, def = false): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return def;
  return ['1', 'true', 'yes', 'y', 'on'].includes(v);
}

/**
 * GET /api/v1/status
 * Always returns an OK object with plan + quota.
 * In dev (or when DEV_UNLIMITED=1/true) we report huge quota so the UI never blocks.
 */
router.get('/status', (req: Request, res: Response) => {
  // Identify caller (for logs; not strictly required)
  const uid =
    (req.header('x-galactly-user') || 'anon')
      .toString()
      .slice(0, 64);

  // If you want to pretend pro in the UI you can pass x-galactly-plan: pro
  const plan =
    (req.header('x-galactly-plan') || 'free')
      .toString()
      .toLowerCase() === 'pro'
      ? 'pro'
      : 'free';

  // Dev switch: default ON while you’re building.
  // Set DEV_UNLIMITED=false in your service env to re-enable real quota later.
  const devUnlimited =
    flag('DEV_UNLIMITED', true) ||
    // opt-in via query if you ever want to force it from the browser: ?dev=1
    ['1', 'true'].includes(String(req.query.dev || '').toLowerCase());

  // For now we don’t look up real usage – just report a generous budget
  const today = new Date().toISOString().slice(0, 10);
  const quota = devUnlimited
    ? {
        date: today,
        findsUsed: 0,
        revealsUsed: 0,
        findsLeft: 999,
        revealsLeft: 999
      }
    : {
        // When you’re ready to enforce, swap these with real counters
        date: today,
        findsUsed: 0,
        revealsUsed: 0,
        findsLeft: 5,      // <- realistic free budget
        revealsLeft: 1
      };

  res.json({
    ok: true,
    uid,
    plan,
    quota,
    devUnlimited
  });
});

export default router;
