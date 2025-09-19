import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import handleFindBuyers from './handlers/find-buyers';

const app = express();

// middlewares
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// health
app.get('/healthz', (_req: Request, res: Response) => res.status(200).send('ok'));

// legacy-stable endpoint used by the Free Panel
app.post('/api/v1/leads/find-buyers', handleFindBuyers);

// 404 for everything else (kept simple and JSON)
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    method: req.method,
    path: req.path,
  });
});

// central error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  const message = err?.message ?? 'Internal Server Error';
  res.status(status).json({ error: 'INTERNAL_ERROR', message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  // compact route table log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack = (app as any)?._router?.stack ?? [];
  const routes = stack
    .flatMap((l: any) =>
      l?.route
        ? Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`)
        : l?.name === 'router' && l.handle?.stack
        ? l.handle.stack
            .filter((s: any) => s.route)
            .flatMap((s: any) => Object.keys(s.route.methods).map((m) => `${m.toUpperCase()} ${s.route.path}`))
        : []
    )
    .filter(Boolean);

  console.log(`[server] listening on :${port}`);
  console.log(`[server] routes:\n  ${routes.join('\n  ')}`);
});

export default app;