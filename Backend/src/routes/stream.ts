// backend/src/routes/stream.ts
// SSE + polling for preview metrics and live leads.
// Wire this in index.ts with:  registerStreamRoutes(app, ctx)

import type { Request, Response, Express } from 'express';

/** Minimal task/queue contracts shared with find-now/progress routes */
type PreviewEvent = { type: 'metric' | 'counts'; metric?: string; tier?: 'free' | 'pro'; score?: number; text?: string; counts?: { free: number; pro: number } };
type Lead = {
  title?: string;
  company_domain?: string;
  domain?: string;
  brand?: string;
  state?: string;
  region?: string;
  channel?: string;
  intent?: string;
  reason?: string;
  qty?: string | number;
  material?: string;
  deadline?: string;
  url?: string;
  source?: string;
  locked?: boolean;
};

type Task = {
  id: string;
  userId: string;
  createdAt: number;
  done?: boolean;
  /** queues are pushed by /find-now worker */
  previewQ: PreviewEvent[];
  leadsQ: Lead[];
  /** snapshots (for polling cursors) */
  previewIdx?: number;
  leadsIdx?: number;
};

type Ctx = {
  /** In-memory task registry. Your /find-now should add tasks here and push events. */
  tasks: Map<string, Task>;
};

function getTask(ctx: Ctx, id?: string) {
  if (!id) return undefined;
  return ctx.tasks.get(id);
}

function sseHeaders(res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx/proxy
  });
  res.flushHeaders?.();
}

function send(res: Response, evt: unknown) {
  res.write(`data: ${JSON.stringify(evt)}\n\n`);
}

function drainPreview(task: Task) {
  const out = task.previewQ.splice(0, task.previewQ.length);
  task.previewIdx = (task.previewIdx || 0) + out.length;
  return out;
}

function drainLeads(task: Task) {
  const out = task.leadsQ.splice(0, task.leadsQ.length);
  task.leadsIdx = (task.leadsIdx || 0) + out.length;
  return out;
}

export default function registerStreamRoutes(app: Express, ctx: Ctx) {
  /**
   * Server-Sent Events: preview metrics stream
   * GET /api/v1/stream/preview?task=ID
   */
  app.get('/api/v1/stream/preview', (req: Request, res: Response) => {
    const t = getTask(ctx, String(req.query.task || ''));
    if (!t) return res.status(404).json({ ok: false, error: 'task_not_found' });

    sseHeaders(res);

    // Immediately flush anything pending
    drainPreview(t).forEach((e) => send(res, e));

    const iv = setInterval(() => {
      const batch = drainPreview(t);
      if (batch.length) batch.forEach((e) => send(res, e));
      if (t.done) {
        send(res, { done: true });
        clearInterval(iv);
        res.end();
      }
    }, 500);

    req.on('close', () => clearInterval(iv));
  });

  /**
   * Server-Sent Events: leads stream
   * GET /api/v1/stream/leads?task=ID
   */
  app.get('/api/v1/stream/leads', (req: Request, res: Response) => {
    const t = getTask(ctx, String(req.query.task || ''));
    if (!t) return res.status(404).json({ ok: false, error: 'task_not_found' });

    sseHeaders(res);

    const flush = () => {
      const batch = drainLeads(t);
      if (batch.length) send(res, { type: 'leads', batch });
    };

    flush();

    const iv = setInterval(() => {
      flush();
      if (t.done) {
        send(res, { done: true });
        clearInterval(iv);
        res.end();
      }
    }, 500);

    req.on('close', () => clearInterval(iv));
  });

  /**
   * Polling fallback for preview
   * GET /api/v1/preview/poll?task=ID
   */
  app.get('/api/v1/preview/poll', (req: Request, res: Response) => {
    const t = getTask(ctx, String(req.query.task || ''));
    if (!t) return res.status(404).json({ ok: false, error: 'task_not_found' });
    const metrics = drainPreview(t);
    res.json({ ok: true, metrics, counts: metrics.find((m) => (m as any).counts)?.counts, done: !!t.done });
  });

  /**
   * Polling fallback for leads
   * GET /api/v1/leads/poll?task=ID
   */
  app.get('/api/v1/leads/poll', (req: Request, res: Response) => {
    const t = getTask(ctx, String(req.query.task || ''));
    if (!t) return res.status(404).json({ ok: false, error: 'task_not_found' });
    const batch = drainLeads(t);
    res.json({ ok: true, batch, done: !!t.done });
  });

  /**
   * Tiny helper to inspect a task (optional)
   * GET /api/v1/tasks/:id
   */
  app.get('/api/v1/tasks/:id', (req: Request, res: Response) => {
    const t = getTask(ctx, req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: 'task_not_found' });
    res.json({
      ok: true,
      id: t.id,
      createdAt: t.createdAt,
      queues: { preview: t.previewQ.length, leads: t.leadsQ.length },
      done: !!t.done,
    });
  });
}
