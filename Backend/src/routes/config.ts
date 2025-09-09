import type { Express, Request, Response } from 'express';

export default function registerConfigRoutes(app: Express) {
  app.get('/api/v1/config', (_req: Request, res: Response) => {
    const allowList = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    res.json({
      ok: true,
      env: process.env.NODE_ENV || 'dev',
      devUnlimited: (process.env.DEV_UNLIMITED || '').toLowerCase() === 'true',
      allowList,
      version: process.env.BUILD_SHA || process.env.SOURCE_VERSION || 'dev',
      time: new Date().toISOString(),
    });
  });
}
