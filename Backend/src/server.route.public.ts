import type { Express, Request, Response } from 'express';

export default function registerPublic(app: Express) {
  // Simple ping for uptime monitors
  app.get('/api/v1/public/ping', (_req: Request, res: Response) => {
    res.json({ ok: true, pong: true, time: new Date().toISOString() });
  });

  // Echo helpers for quick client sanity checks
  app.get('/api/v1/public/echo', (req: Request, res: Response) => {
    res.json({ ok: true, method: 'GET', query: req.query, time: new Date().toISOString() });
  });

  app.post('/api/v1/public/echo', (req: Request, res: Response) => {
    res.json({ ok: true, method: 'POST', body: req.body, time: new Date().toISOString() });
  });
}
