// backend/src/routes/find-now.ts
// Creates a search task and lets a background runner push preview metrics + leads
// into ctx.tasks so /stream/* can serve them live.

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

type FindNowInput = {
  website?: string;
  regions?: string;
  industries?: string;
  seed_buyers?: string;
  notes?: string;
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
  // Optional: your real search runner. If present, we'll use it.
  // It should call the provided emitPreview / emitLead callbacks.
  runFindNow?: (
    input: FindNowInput & { userId: string; taskId: string },
    emitPreview: (e: PreviewEvent) => void,
    emitLead: (l: Lead) => void
  ) => Promise<void>;
  // Optional: quota helpers (no-op if missing)
  quota?: {
    take: (userId: string, kind: 'find') => Promise<void>;
    status: (userId: string) => Promise<any>;
  };
};

function ok(res: Response, body: any) {
  res.json({ ok: true, ...body });
}

function bad(res: Response, error: string, code = 400) {
  res.status(code).json({ ok: false, error });
}

function norm(v?: string) {
  return (v || '').trim();
}

export default function registerFindNowRoutes(app: Express, ctx: Ctx) {
  app.post('/api/v1/find-now', async (req: Request, res: Response) => {
    const userId = (req.header('x-galactly-user') || '').toString() || 'anon';
    const input: FindNowInput = {
      website: norm(req.body?.website),
      regions: norm(req.body?.regions),
      industries: norm(req.body?.industries),
      seed_buyers: norm(req.body?.seed_buyers),
      notes: norm(req.body?.notes),
    };

    // minimal validation (website is strongly recommended but not forced while dev)
    if (!input.website) {
      // allow blank in dev but warn
      // return bad(res, 'website_required', 422);
    }

    // quota (best-effort)
    try {
      await ctx.quota?.take?.(userId, 'find');
    } catch {
      // ignore; front-end still runs in dev
    }

    const taskId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const task: Task = {
      id: taskId,
      userId,
      createdAt: Date.now(),
      previewQ: [],
      leadsQ: [],
    };
    ctx.tasks.set(taskId, task);

    const emitPreview = (e: PreviewEvent) => task.previewQ.push(e);
    const emitLead = (l: Lead) => task.leadsQ.push(l);

    // kick worker (do not await)
    (async () => {
      try {
        if (ctx.runFindNow) {
          // Use your real pipeline when provided
          await ctx.runFindNow({ ...input, userId, taskId }, emitPreview, emitLead);
        } else {
          // Lightweight placeholder pipeline (does not fabricate "hot" claims)
          // Emits structure only so the UI renders; replace with real gatherers.
          emitPreview({ type: 'counts', counts: { free: 16, pro: 1126 } });

          const steps: Array<[string, () => Promise<void>]> = [
            [
              'Notes',
              async () => {
                if (input.notes) {
                  emitPreview({
                    type: 'metric',
                    metric: 'Notes',
                    tier: 'free',
                    text: input.notes.slice(0, 200),
                  });
                }
              },
            ],
            [
              'Seeds',
              async () => {
                const seeds = (input.seed_buyers || '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 6);
                if (seeds.length) {
                  emitPreview({
                    type: 'metric',
                    metric: 'Seeds',
                    tier: 'free',
                    text: seeds.join(', '),
                  });
                }
              },
            ],
            [
              'Regions',
              async () => {
                if (input.regions) {
                  emitPreview({
                    type: 'metric',
                    metric: 'Regions',
                    tier: 'free',
                    text: input.regions,
                  });
                }
              },
            ],
            [
              'Industries',
              async () => {
                if (input.industries) {
                  emitPreview({
                    type: 'metric',
                    metric: 'Industries',
                    tier: 'free',
                    text: input.industries,
                  });
                }
              },
            ],
          ];

          for (const [_, fn] of steps) {
            await fn();
            await new Promise((r) => setTimeout(r, 120));
          }

          // Emit a couple of neutral leads ONLY if caller attaches a real runner later.
          // Here we leave the queue empty—front-end will show none until your real pipeline fills it.
        }
      } catch (err) {
        emitPreview({
          type: 'metric',
          metric: 'Error',
          tier: 'free',
          text: 'Search pipeline failed',
        });
      } finally {
        task.done = true;
      }
    })().catch(() => {});

    // respond with task id and a snapshot of quota
    let quota: any = undefined;
    try {
      quota = await ctx.quota?.status?.(userId);
    } catch {
      quota = undefined;
    }

    ok(res, { task: taskId, quota });
  });
}
