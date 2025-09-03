/* Backend/src/index.ts
   Galactly dev backend — job-based progress stream (fixed signature).
   - /api/v1/find-now        -> { ok:true, jobId }
   - /api/v1/progress.sse    -> streams only that job’s events
   - /api/v1/status, /presence/*, /vault are included
*/

import express from 'express';
import cors from 'cors';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';

const app = express();
const PORT = process.env.PORT || 8787;

app.use(express.json());
app.use(cors()); // permissive for dev; tighten in prod

/* ---------- small helpers ---------- */

function route<T extends 'get' | 'post'>(method: T, path: string, handler: any) {
  // always mounts under /api/v1
  // @ts-ignore
  app[method](`/api/v1${path}`, handler);
}

function newId(prefix: string) {
  return prefix + randomBytes(6).toString('hex');
}

/* ---------- types ---------- */

type LeadEvt = {
  type: 'lead';
  site?: string;
  state?: string;
  channel?: string;
  title: string;
  detail: string;
  at: number;
};

type StepEvt = {
  type: 'step';
  freeDone: number;
  freeTotal: number;
  proDone: number;
  proTotal: number;
};

type PreviewEvt = { type: 'preview'; line: string };
type HaltEvt = { type: 'halt' };

type ProgressEvt = LeadEvt | StepEvt | PreviewEvt | HaltEvt;

type JobParams = {
  website?: string;
  regions?: string;
  industries?: string;
  buyers?: string;
  notes?: string;
};

type JobState = {
  id: string;
  params: JobParams;
  em: EventEmitter;
  done: boolean;
  createdAt: number;
};

/* ---------- in-memory stores ---------- */

const JOBS = new Map<string, JobState>();
const VAULT = new Map<string, JobParams>();

/* ---------- presence / status ---------- */

route('get', '/status', (req, res) => {
  const devUnlimited = req.headers['x-dev-unlim'] === 'true';

  res.json({
    ok: true,
    uid: String(req.headers['x-galactly-user'] || 'u-dev'),
    plan: 'free',
    quota: devUnlimited
      ? { date: new Date().toISOString().slice(0, 10), findsUsed: 0, revealsUsed: 0, findsLeft: Infinity, revealsLeft: Infinity }
      : { date: new Date().toISOString().slice(0, 10), findsUsed: 0, revealsUsed: 0, findsLeft: 99, revealsLeft: 5 },
    devUnlimited,
  });
});

let ONLINE = 1;
route('get', '/presence/online', (_req, res) => res.json({ total: ONLINE }));
route('post', '/presence/beat', (_req, res) => {
  ONLINE = Math.max(1, ONLINE);
  res.json({ ok: true });
});

/* ---------- vault ---------- */

route('post', '/vault', (req, res) => {
  const uid = String(req.headers['x-galactly-user'] || 'u-dev');
  const b = req.body || {};
  VAULT.set(uid, {
    website: (b.website || '').toString(),
    regions: (b.regions || '').toString(),
    industries: (b.industries || '').toString(),
    buyers: (b.buyers || '').toString(),
    notes: (b.notes || '').toString(),
  });
  res.json({ ok: true });
});

/* ---------- job system ---------- */

function createJob(params: JobParams): JobState {
  const job: JobState = {
    id: newId('j_'),
    params,
    em: new EventEmitter(),
    done: false,
    createdAt: Date.now(),
  };
  JOBS.set(job.id, job);
  return job;
}

function endJob(job: JobState) {
  job.done = true;
  try {
    job.em.emit('evt', <HaltEvt>{ type: 'halt' });
  } catch {}
  setTimeout(() => JOBS.delete(job.id), 60_000);
}

/* ---------- fake provider (optional for dev) ---------- */

const DEV_FAKE = String(process.env.DEV_FAKE ?? 'true').toLowerCase() === 'true';

const US = ['CA','TX','NY','FL','IL','PA','OH','GA','NC','MI','NJ','VA','WA','AZ','MA','TN','IN','MO','MD','WI','MN','CO','AL','SC','LA','KY','OR','OK','CT','UT','IA','NV','AR','MS','KS','NM','NE','WV','ID','HI','ME','NH','MT','RI','DE','SD','ND','AK','DC','VT','WY'];
const CH = ['Email', 'LinkedIn DM', 'ERP', 'SMS', 'Call'];
const DN = [
  { title: '"Need 10k corrugated boxes"', detail: 'RSC • double-wall • 48h turn' },
  { title: '"Quote: 16oz cartons (retail)"', detail: 'PDP restock surge' },
  { title: '"Urgent: custom mailers next week"', detail: 'Kraft • 2-color • die-cut' },
  { title: '"Pouches 5k/mo"', detail: '8oz / 16oz • matte + zipper' },
  { title: '"Stretch wrap pallets"', detail: '80g • 18″ × 1500’' },
];

function previewLine(n: number) {
  const L = [
    'Demand: ad-spend → purchases → “box” tokens',
    'Timing: promo cadence → restock windows',
    'Product: PDP deltas → new pack sizes',
    'Reviews: failure tokens → “crushed”, “leak”',
    'Ops: hiring feed → inbound ops → carton throughput',
    'Finance: turns ↑ → wrap usage ↑',
  ];
  return L[n % L.length];
}

async function* fakeProvider(params: JobParams) {
  const site = (params.website || 'example.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  for (let k = 0; k < 16; k++) {
    await new Promise((r) => setTimeout(r, 1100 + Math.random() * 450));
    const d = DN[(Math.random() * DN.length) | 0];
    const ev: LeadEvt = {
      type: 'lead',
      site,
      state: US[(Math.random() * US.length) | 0],
      channel: CH[(Math.random() * CH.length) | 0],
      title: d.title,
      detail: `${d.detail} • ${site}`,
      at: Date.now(),
    };
    yield ev;
  }
}

/* ---------- run scan ---------- */

async function runScan(job: JobState) {
  let i = 0;
  const tick = setInterval(() => {
    const step: StepEvt = {
      type: 'step',
      freeDone: Math.min(60, 2 * i + 3),
      freeTotal: 1126,
      proDone: Math.min(840, 14 * i + 20),
      proTotal: 1126,
    };
    job.em.emit('evt', step);
    if (i % 2 === 0) job.em.emit('evt', <PreviewEvt>{ type: 'preview', line: previewLine(i / 2) });
    i++;
  }, 900);

  try {
    if (DEV_FAKE) {
      for await (const ev of fakeProvider(job.params)) job.em.emit('evt', ev as ProgressEvt);
    } else {
      // TODO: wire real providers here:
      // for await (const ev of aggregateProviders(job.params)) job.em.emit('evt', ev);
    }
  } catch {
    // swallow in dev
  } finally {
    clearInterval(tick);
    endJob(job);
  }
}

/* ---------- routes ---------- */

route('post', '/find-now', (req, res) => {
  const b = (req.body || {}) as JobParams;
  const job = createJob({
    website: (b.website || '').toString(),
    regions: (b.regions || '').toString(),
    industries: (b.industries || '').toString(),
    buyers: (b.buyers || '').toString(),
    notes: (b.notes || '').toString(),
  });
  // fire-and-forget
  runScan(job);
  res.json({ ok: true, jobId: job.id });
});

route('get', '/progress.sse', (req, res) => {
  const jobId = String((req.query as any).job || '');
  const job = JOBS.get(jobId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!job) {
    res.write(`data: ${JSON.stringify(<HaltEvt>{ type: 'halt' })}\n\n`);
    return res.end();
  }

  const onEvt = (payload: ProgressEvt) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  job.em.on('evt', onEvt);
  req.on('close', () => job.em.off('evt', onEvt));
});

/* ---------- boot ---------- */

app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
