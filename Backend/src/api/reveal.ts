import type { Express, Request, Response } from 'express';

export function mountReveal(app: Express) {
  app.get('/api/v1/reveal/ping', (_req: Request, res: Response) => {
    res.json({ ok: true, reveal: 'ready', time: new Date().toISOString() });
  });
}
