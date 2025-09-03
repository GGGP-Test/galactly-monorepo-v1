// backend/src/health.ts
// Health + diagnostics endpoints.
// Wire in src/index.ts with:  import registerHealth from './health'; registerHealth(app, ctx);

import type { Express, Request, Response } from 'express';

type Ctx = {
  devUnlimited?: boolean;
  limits?: {
    freeFindsPerDay: number;
    freeRevealsPerDay: number;
    proFindsPerDay: number;
    proRevealsPerDay: number;
  };
};

function listRoutes(app: Express) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack: any[] = (app as any)?._router?.stack || [];
  const routes: Array<{ method: string; path: string }> = [];
  for (const layer of stack) {
    if (layer.route) {
      const path = layer.route?.path || '';
      const methods = Object.keys(layer.route.methods || {});
      methods.forEach((m) => routes.push({ method: m.toUpperCase(), path }));
    } else if (layer.name === 'router' && layer.handle?.stack) {
      for (const r of layer.handle.stack) {
        const route = r.route;
        if (route) {
          const path = route.path || '';
          const methods = Object.keys(route.methods || {});
          methods.forEach((m) => routes.push({ method: m.toUpperCase(), path }));
        }
      }
    }
  }
  return routes;
}

function ok(res: Response, body: unknown) {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...((body as object) || {}) });
}

export default function registerHealth(app: Express, ctx: Ctx) {
  const version = process.env.APP_VERSION || 'dev';
  const startedAt = Date.now();

  const healthPayload = () => ({
    version,
    time: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    pid: process.pid,
    memory: process.memoryUsage?.(),
    devUnlimited: !!ctx.devUnlimited || (process.env.DEV_UNLIMITED || '').toLowerCase() === 'true',
    limits: ctx.limits || {
      freeFindsPerDay: Number(process.env.FREE_FINDS_PER_DAY || 2),
      freeRevealsPerDay: Number(process.env.FREE_REVEALS_PER_DAY || 2),
      proFindsPerDay: Number(process.env.PRO_FINDS_PER_DAY || 100),
      proRevealsPerDay: Number(process.env.PRO_REVEALS_PER_DAY || 100),
    },
    checks: {
      node: process.version,
      env: process.env.NODE_ENV || 'development',
    },
  });

  // Basic health
  app.get('/healthz', (_req: Request, res: Response) => ok(res, healthPayload()));
  app.get('/api/v1/healthz', (_req: Request, res: Response) => ok(res, healthPayload()));

  // Routes listing (for troubleshooting)
  app.get('/__routes', (req: Request, res: Response) => {
    const routes = listRoutes(app);
    const q = String(req.query.q || '').toLowerCase();
    const filtered = q ? routes.filter((r) => r.path.toLowerCase().includes(q)) : routes;
    ok(res, { count: filtered.length, routes: filtered });
  });

  // Version & minimal env snapshot (sanitized)
  app.get('/__version', (_req: Request, res: Response) => ok(res, { version }));
  app.get('/__env', (_req: Request, res: Response) =>
    ok(res, {
      NODE_ENV: process.env.NODE_ENV || 'development',
      DEV_UNLIMITED: process.env.DEV_UNLIMITED || 'false',
      FREE_FINDS_PER_DAY: process.env.FREE_FINDS_PER_DAY || '2',
      FREE_REVEALS_PER_DAY: process.env.FREE_REVEALS_PER_DAY || '2',
      PRO_FINDS_PER_DAY: process.env.PRO_FINDS_PER_DAY || '100',
      PRO_REVEALS_PER_DAY: process.env.PRO_REVEALS_PER_DAY || '100',
    })
  );

  // Dev helper to toggle DEV_UNLIMITED at runtime (memory flag only)
  app.post('/__toggle/dev-unlimited', (req: Request, res: Response) => {
    const v = String((req.query.value ?? req.body?.value ?? '') as string).toLowerCase();
    if (v === 'true' || v === '1' || v === 'on') ctx.devUnlimited = true;
    else if (v === 'false' || v === '0' || v === 'off') ctx.devUnlimited = false;
    ok(res, { devUnlimited: !!ctx.devUnlimited });
  });
}
