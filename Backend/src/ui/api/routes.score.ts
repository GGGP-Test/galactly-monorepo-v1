import type { Request, Response } from 'express';
import type { App } from '../../index';

export function mountScore(app: App) {
  app.post('/api/v1/score', async (req: Request, res: Response) => {
    res.json({ ok: true, score: 0 });
  });
}
