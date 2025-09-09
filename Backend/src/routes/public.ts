// Backend/src/routes/public.ts
import type express from 'express';

export function mountPublic(app: express.Express) {
  app.get('/api/v1/public/ping', (_req, res) => {
    res.json({ ok: true, pong: true, time: new Date().toISOString() });
  });

  app.get('/api/v1/config', (_req, res) => {
    const allowList = (process.env.ALLOW_LIST || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    res.json({
      ok: true,
      env: process.env.NODE_ENV || 'development',
      devUnlimited: !!process.env.DEV_UNLIMITED,
      allowList,
      version: process.env.VERSION || 'dev',
      time: new Date().toISOString()
    });
  });
}
