import { Router, Request, Response } from 'express';

type ScoreBody = {
  tenantId: string;
  usd: number;
  meta?: Record<string, unknown>;
};

export function createScoreRouter(): Router {
  const router = Router();

  // basic health probe for this router
  router.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  // minimal score endpoint (adjust to your real use)
  router.post('/api/score', (req: Request<{}, any, ScoreBody>, res: Response) => {
    const body = req.body || ({} as ScoreBody);

    if (!body.tenantId || typeof body.usd !== 'number') {
      return res.status(400).json({ error: 'tenantId (string) and usd (number) are required' });
    }

    // TODO: persist or forward score; placeholder success
    return res.status(200).json({ received: true, tenantId: body.tenantId, usd: body.usd });
  });

  return router;
}

export default createScoreRouter;
