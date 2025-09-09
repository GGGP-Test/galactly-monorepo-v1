// Backend/src/routes/public.ts
import type express from 'express';

export function mountPublic(app: express.Express) {
  app.get('/api/v1/public/ping', (_req, res) =>
    res.json({ ok: true, pong: true, time: new Date().toISOString() })
  );

  // Simple echo (GET & POST)
  app.get('/api/v1/public/echo', (req, res) =>
    res.json({ ok: true, method: 'GET', query: req.query })
  );
  app.post('/api/v1/public/echo', (req, res) =>
    res.json({ ok: true, method: 'POST', body: req.body })
  );
}
