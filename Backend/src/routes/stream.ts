// backend/src/routes/stream.ts
// SSE endpoints used by the Free Panel.
// - GET /api/v1/stream/preview?task=...&uid=...
// - GET /api/v1/stream/leads?task=...&uid=...
//
// Also provides lightweight poll fallbacks:
// - GET /api/v1/preview/poll?task=...&cursor=...
// - GET /api/v1/leads/poll?task=...&cursor=...

import type { Express, Request, Response } from 'express';

type PreviewEvent = {
  type: 'counts' | 'metric';
  counts?: { free: number; pro: number };
  metric?: string;
  tier?: 'free' | 'pro';
  score?: number;
  text?: string;
};

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
  previewQ: PreviewEvent[];
  leadsQ: Lead[];
};

type Ctx = { tasks: Map<string, Task> };

function sseInit(res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Default retry
  res.write('retry: 2500\n\n');
  (res as any).flushHeaders?.();
}

function sseMsg(res: Response, data: any) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseHeartbeat(res: Response) {
  res.write(': ping\n\n');
}

export default function registerStreamRoutes(app: Express, ctx: Ctx) {
  // ------- Preview stream (metrics/counts) -------
  app.get('/api/v1/stream/preview', (req: Request, res: Response) => {
    const taskId = String(req.query.task || '');
    const uid = String(req.query.uid || '');
    const task = ctx.tasks.get(taskId);
    if (!task || (uid && task.userId && uid !== task.userId)) {
      return res.status(404).json({ ok: false, error: 'task_not_found' });
    }

    sseInit(res);

    // drain any pending immediately
    while (task.previewQ.length) sseMsg(res, task.previewQ.shift());

    const beat = setInterval(() => sseHeartbeat(res), 15000);
    const loop = setInterval(() => {
      while (task.previewQ.length) sseMsg(res, task.previewQ.shift());

      if (task.done && task.previewQ.length === 0) {
        sseMsg(res, { done: true });
        clearInterval(loop);
        clearInterval(beat);
        res.end();
      }
    }, 700);

    req.on('close', () => {
      clearInterval(loop);
      clearInterval(beat);
    });
  });

  // ------- Leads stream (batches) -------
  app.get('/api/v1/stream/leads', (req: Request, res: Response) => {
    const taskId = String(req.query.task || '');
    const uid = String(req.query.uid || '');
    const task = ctx.tasks.get(taskId);
    if (!task || (uid && task.userId && uid !== task.userId)) {
      return res.status(404).json({ ok: false, error: 'task_not_found' });
    }

    sseInit(res);

    // send any queued leads as a single batch right away
    if (task.leadsQ.length) {
      const batch = task.leadsQ.splice(0, task.leadsQ.length);
      sseMsg(res, { batch });
    }

    const beat = setInterval(() => sseHeartbeat(res), 15000);
    const loop = setInterval(() => {
      if (task.leadsQ.length) {
        const batch = task.leadsQ.splice(0, task.leadsQ.length);
        sseMsg(res, { batch });
      }

      if (task.done && task.leadsQ.length === 0) {
        sseMsg(res, { done: true });
        clearInterval(loop);
        clearInterval(beat);
        res.end();
      }
    }, 650);

    req.on('close', () => {
      clearInterval(loop);
      clearInterval(beat);
    });
  });

  // ------- Poll fallbacks (Free Panel calls these if SSE fails) -------
  app.get('/api/v1/preview/poll', (req: Request, res: Response) => {
    const taskId = String(req.query.task || '');
    const task = ctx.tasks.get(taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'task_not_found' });

    const metrics: Array<{ id: string; tier: 'free' | 'pro'; score: number; text?: string }> = [];
    let counts: { free: number; pro: number } | undefined;

    // drain once per poll
    while (task.previewQ.length) {
      const ev = task.previewQ.shift()!;
      if (ev.type === 'counts' && ev.counts) counts = ev.counts;
      if (ev.type === 'metric' && ev.metric && ev.tier) {
        metrics.push({ id: ev.metric, tier: ev.tier, score: ev.score || 0, text: ev.text });
      }
    }

    res.json({ ok: true, done: !!task.done, metrics, counts });
  });

  app.get('/api/v1/leads/poll', (req: Request, res: Response) => {
    const taskId = String(req.query.task || '');
    const task = ctx.tasks.get(taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'task_not_found' });

    // drain everything this tick
    const batch = task.leadsQ.splice(0, task.leadsQ.length);
    res.json({ ok: true, done: !!task.done, batch });
  });
}
