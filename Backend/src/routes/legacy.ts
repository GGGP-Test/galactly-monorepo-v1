import { Router, Request, Response } from 'express';
import findBuyers from '../services/find-buyers';

const router = Router();

/**
 * Legacy endpoint kept for backwards-compat with the Free Panel.
 * POST /api/v1/leads/find-buyers
 */
router.post('/api/v1/leads/find-buyers', async (req: Request, res: Response) => {
  try {
    const result = await findBuyers(req.body ?? {});
    return res.status(200).json(result);
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error';
    return res.status(500).json({ error: 'INTERNAL_ERROR', message });
  }
});

// Optional quick check
router.get('/healthz', (_req, res) => res.status(200).send('ok'));

export default router;