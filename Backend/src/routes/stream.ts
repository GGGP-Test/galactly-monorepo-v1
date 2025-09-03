// backend/src/routes/stream.ts
// Server-Sent Events for preview metrics and leads produced by /find-now worker.

import type { Express, Request, Response } from 'express';

type PreviewEvent = {
  type: 'metric' | 'counts';
  metric?: string;
  tier?: 'free' | 'pro';
  score?: number;
  text?: string;
  counts?: { free: number; pro: number };
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

type Ctx = {
  tasks: Map<string, Task>;
};

function sseInit(res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx
  });
  res.flushHeaders?.();
}

function sseSend(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseHeartbeat(res: Response) {
  res.write(': ping\n\n');
}

export default function registerStreamRoutes(app: Express, ctx: Ctx) {
  // Preview metrics stream
  app.get('/api/v1/stream/preview/:taskId', (req: Request, res: Response) => {
    const taskId = req.params.taskId;
    const userId = (req.header('x-galactly-user') || '').toString() || 'anon';
    const task = ctx.tasks.get(taskId);
    if (!task || task.userId !== userId) {
      res.status(404).json({ ok: false, error: 'task_not_found' });
      return;
    }

    sseInit(res);

    // Drain any queued preview events immediately
    while (task.previewQ.length) {
      sseSend(res, 'preview', task.previewQ.shift());
    }

    const iv = setInterval(() => {
      // heartbeat
      sseHeartbeat(res);

      // forward newly queued events
      while (task.previewQ.length) {
        sseSend(res, 'preview', task.previewQ.shift());
      }

      if (task.done && task.previewQ.length === 0) {
        sseSend(res, 'done', { ok: true });
        clearInterval(iv);
        res.end();
      }
    }, 750);

    req.on('close', () => {
      clearInterval(iv);
    });
  });

  // Leads stream
  app.get('/api/v1/stream/leads/:taskId', (req: Request, res: Response) => {
    const taskId = req.params.taskId;
    const userId = (req.header('x-galactly-user') || '').toString() || 'anon';
    const task = ctx.tasks.get(taskId);
    if (!task || task.userId !== userId) {
      res.status(404).json({ ok: false, error: 'task_not_found' });
      return;
    }

    sseInit(res);

    // Send existing queued leads at connect time
    while (task.leadsQ.length) {
      sseSend(res, 'lead', task.leadsQ.shift());
    }

    const iv = setInterval(() => {
      sseHeartbeat(res);

      while (task.leadsQ.length) {
        sseSend(res, 'lead', task.leadsQ.shift());
      }

      if (task.done && task.leadsQ.length === 0) {
        sseSend(res, 'done', { ok: true });
        clearInterval(iv);
        res.end();
      }
    }, 700);

    req.on('close', () => {
      clearInterval(iv);
    });
  });
}
