// backend/src/routes/find-now.ts
// Kicks off a simple in-memory "find now" task and queues preview + lead events
// that /stream/* endpoints will drain.

import type { Express, Request, Response } from 'express';

type PreviewEvent = {
  type: 'counts' | 'metric';
  counts?: { free: number; pro: number };
  metric?: string;                    // ids used by the Free Panel
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

type Ctx = {
  tasks: Map<string, Task>;
  quota?: {
    take?: (userId: string, kind: 'find') => Promise<void>;
    status?: (userId: string) => Promise<{
      date: string;
      findsUsed: number;
      revealsUsed: number;
      findsLeft: number;
      revealsLeft: number;
    }>;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createTask(userId: string): Task {
  const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { id, userId, createdAt: Date.now(), previewQ: [], leadsQ: [] };
}

function emitPreview(task: Task, ev: PreviewEvent) {
  task.previewQ.push(ev);
}
function emitLead(task: Task, lead: Lead) {
  task.leadsQ.push(lead);
}

function parseSeeds(s: string): string[] {
  return (s || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .map((x) => x.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .slice(0, 6);
}

export default function registerFindNowRoutes(app: Express, ctx: Ctx) {
  app.post('/api/v1/find-now', async (req: Request, res: Response) => {
    const userId = (req.header('x-galactly-user') || '').toString() || 'anon';

    const input = {
      website: String(req.body?.website || ''),
      regions: String(req.body?.regions || ''),
      industries: String(req.body?.industries || ''),
      seed_buyers: String(req.body?.seed_buyers || ''),
      notes: String(req.body?.notes || ''),
    };

    // best-effort quota tick
    try {
      await ctx.quota?.take?.(userId, 'find');
    } catch {
      /* ignore in dev */
    }

    // create task
    const task = createTask(userId);
    ctx.tasks.set(task.id, task);

    // kick lightweight background worker (fire-and-forget)
    (async () => {
      try {
        // counts first so UI shows totals immediately
        emitPreview(task, { type: 'counts', counts: { free: 16, pro: 1126 } });

        // narrative → metric events (ids must match Free Panel report)
        type Row = [id: string, freeScore: number, proScore: number, text?: string];
        const steps: Row[] = [
          ['demand', 36, 78, input.industries ? `${input.industries} paid reach` : 'paid reach hints'],
          ['buysigs', 22, 64, 'mentions & ad proofs'],
          ['rfps', 18, 54, 'supplier intake present'],
          ['retail', 28, 62, 'PDP cadence'],
          ['hiring', 14, 40, 'ops / shift adds'],
          ['ops', 20, 58, 'stack signals'],
          ['budget', 24, 52, 'posture'],
        ];

        for (const [id, f, p, t] of steps) {
          emitPreview(task, { type: 'metric', metric: id, tier: 'free', score: f, text: t });
          await sleep(120);
          emitPreview(task, { type: 'metric', metric: id, tier: 'pro', score: p, text: t });
          await sleep(120);
        }

        // queue a few demo leads based on seeds (or fallback)
        const seeds = parseSeeds(input.seed_buyers);
        const sample = seeds.length
          ? seeds
          : ['riverbendsnacks.com', 'peakoutfitters.com', 'marathonlabs.com', 'oakcrestfoods.com'];

        const STATES = ['GA', 'CA', 'TX', 'NC', 'OH', 'PA', 'IL', 'WA'];
        const INTENTS = ['corrugated boxes', 'stretch wrap pallets', 'custom mailers (kraft)', 'labels (unit)'];

        for (let i = 0; i < Math.min(sample.length, 6); i++) {
          await sleep(300);
          const dom = sample[i];
          const intent = INTENTS[i % INTENTS.length];
          emitLead(task, {
            title: `Lead — ${dom}`,
            domain: dom,
            state: STATES[i % STATES.length],
            channel: ['Email', 'LinkedIn DM', 'Call'][i % 3],
            intent,
            reason: `Matched to ${input.website || 'your focus'} via ${input.industries || 'sector'} & recent mentions of ${intent}.`,
            source: 'aggregated',
          });
        }
      } catch {
        // swallow; keep stream robust
      } finally {
        // allow streamers to finish draining queues
        await sleep(300);
        task.done = true;
      }
    })().catch(() => {});

    // response to caller
    let quota: any = undefined;
    try {
      quota = await ctx.quota?.status?.(userId);
    } catch {
      quota = undefined;
    }

    res.json({
      ok: true,
      task: task.id,
      preview: { counts: { free: 16, pro: 1126 } }, // optional hint for UI
      quota,
    });
  });
}
