/* Backend/src/index.ts
   Galactly API — healthz + job-scoped progress stream
   Providers mode is controlled by env:
     PROVIDERS_MODE=fake | real   (default: fake)
     DEV_FAKE=true/false          (legacy switch; true forces fake)
*/

import express from 'express';
import cors from 'cors';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';

const app = express();
const PORT = process.env.PORT || 8787;

/* ---------- middleware ---------- */
app.use(express.json());
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'x-galactly-user', 'x-dev-unlim'],
    methods: ['GET', 'POST', 'OPTIONS'],
  }),
);

/* ---------- health ---------- */
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/api/v1/healthz', (_req, res) => res.json({ ok: true }));

/* ---------- tiny helpers ---------- */
const id = (p: string) => p + randomBytes(6).toString('hex');
function route<T extends 'get' | 'post'>(m: T, p: string, h: any) {
  // @ts-ignore
  app[m](`/api/v1${p}`, h);
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

type StepEvt = { type: 'step'; freeDone: number; freeTotal: number; proDone: number; proTotal: number };
type PreviewEvt = { type: 'preview'; line: string };
type HaltEvt = { type: 'halt' };
type ProgressEvt = LeadEvt | StepEvt | PreviewEvt | HaltEvt;

type JobParams = { website?: string; regions?: string; industries?: string; buyers?: string; notes?: string };
type JobState = { id: string; params: JobParams; em: EventEmitter; done: boolean; createdAt: number };

/* ---------- stores ---------- */
const JOBS = new Map<string, JobState>();
const VAULT = new Map<string, JobParams>();

/* ---------- presence / status ---------- */
let ONLINE = 1;

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

/* ---------- providers switch ---------- */
const MODE = (process.env.PROVIDERS_MODE || '').toLowerCase(); // 'fake' | 'real'
const LEGACY_FAKE = (process.env.DEV_FAKE || '').toLowerCase() === 'true';
const USE_FAKE = MODE ? MODE === 'fake' : LEGACY_FAKE || true; // default fake

route('get', '/providers-mode', (_req, res) => {
  res.json({ ok: true, mode: USE_FAKE ? 'fake' : 'real' });
});

/* ---------- fake provider (dev) ---------- */
const US = ['CA','TX','NY','FL','IL','PA','OH','GA','NC','MI','NJ','VA','WA','AZ','MA','TN','IN','MO','MD','WI','MN','CO','AL','SC','LA','KY','OR','OK','CT','UT','IA','NV','AR','MS','KS','NM','NE','WV','ID','HI','ME','NH','MT','RI','DE','SD','ND','AK','DC','VT','WY'];
const CH = ['Email', 'LinkedIn DM', 'ERP', 'SMS', 'Call'];
const DN = [
  { title: '"Need 10k corrugated boxes"', detail: 'RSC • double-wall • 48h turn' },
  { title: '"Quote: 16oz cartons (retail)"', detail: 'PDP restock surge' },
  { title: '"Urgent: custom mailers next week"', detail: 'Kraft • 2-color • die-cut' },
  { title: '"Pouches 5k/mo"', detail: '8oz / 16oz • matte + zipper' },
  { title: '"Stretch wrap pallets"', detail: '80g • 18″ × 1500’' },
];
const PREV = [
  'Demand: ad-spend → purchases → “box” tokens',
  'Timing: promo cadence → restock windows',
  'Product: PDP deltas → new pack sizes',
  'Reviews: failure tokens → “crushed”, “leak”',
  'Ops: hiring feed → inbound ops → carton throughput',
  'Finance: turns ↑ → wrap usage ↑',
];

async function* fakeProvider(params: JobParams) {
  const site = (params.website || 'example.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  for (let k = 0; k < 16; k++) {
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
    const d = DN[(Math.random() * DN.length) | 0];
    yield <LeadEvt>{
      type: 'lead',
      site,
      state: US[(Math.random() * US.length) | 0],
      channel: CH[(Math.random() * CH.length) | 0],
      title: d.title,
      detail: `${d.detail} • ${site}`,
      at: Date.now(),
    };
  }
}

/* ---------- real provider placeholder ---------- */
async function* realProvider(_params: JobParams) {
  // Wire your real sources here; yielding no events by default.
  // eslint-disable-next-line no-empty
  for (;;) break;
}

/* ---------- job runner ---------- */
function createJob(params: JobParams): JobState {
  const j: JobState = { id: id('j_'), params, em: new EventEmitter(), done: false, createdAt: Date.now() };
  JOBS.set(j.id, j);
  return j;
}
function endJob(j: JobState) {
  j.done = true;
  try { j.em.emit('evt', <HaltEvt>{ type: 'halt' }); } catch {}
  setTimeout(() => JOBS.delete(j.id), 60_000);
}

async function runScan(j: JobState) {
  let i = 0;
  const tick = setInterval(() => {
    j.em.emit('evt', <StepEvt>{
      type: 'step',
      freeDone: Math.min(60, 2 * i + 3),
      freeTotal: 1126,
      proDone: Math.min(840, 14 * i + 20),
      proTotal: 1126,
    });
    if (i % 2 === 0) j.em.emit('evt', <PreviewEvt>{ type: 'preview', line: PREV[(i / 2) % PREV.length] });
    i++;
  }, 900);

  try {
    const src = USE_FAKE ? fakeProvider(j.params) : realProvider(j.params);
    for await (const ev of src) j.em.emit('evt', ev as ProgressEvt);
  } catch {}
  clearInterval(tick);
  endJob(j);
}

/* ---------- routes ---------- */
route('post', '/find-now', (req, res) => {
  const b = (req.body || {}) as JobParams;
  const j = createJob({
    website: (b.website || '').toString(),
    regions: (b.regions || '').toString(),
    industries: (b.industries || '').toString(),
    buyers: (b.buyers || '').toString(),
    notes: (b.notes || '').toString(),
  });
  runScan(j);
  res.json({ ok: true, jobId: j.id });
});

route('get', '/progress.sse', (req, res) => {
  const jobId = String((req.query as any).job || '');
  const j = JOBS.get(jobId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!j) {
    res.write(`data: ${JSON.stringify(<HaltEvt>{ type: 'halt' })}\n\n`);
    return res.end();
  }

  const onEvt = (p: ProgressEvt) => res.write(`data: ${JSON.stringify(p)}\n\n`);
  j.em.on('evt', onEvt);
  req.on('close', () => j.em.off('evt', onEvt));
});

/* ---------- boot ---------- */
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
