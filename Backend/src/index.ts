/* Backend/src/index.ts
   Galactly dev backend — job-based progress stream.
   - /find-now -> returns { jobId }
   - /progress.sse?job=... -> streams step / preview / lead for that job only
   - DEV_FAKE=true emits fake-but-parameterized leads for UI testing.
*/

import express from 'express';
import cors from 'cors';
import { randomBytes } from 'crypto';
import EventEmitter from 'events';

const app = express();
const PORT = process.env.PORT || 8787;

app.use(express.json());
app.use(cors()); // in dev we allow all origins; tighten in prod

type LeadEvt = {
  type:'lead';
  site?:string;
  state?:string;
  channel?:string;
  title:string;
  detail:string;
  at:number;
};

type StepEvt = {
  type:'step';
  freeDone:number; freeTotal:number;
  proDone:number;  proTotal:number;
};

type PreviewEvt = { type:'preview'; line:string };
type HaltEvt = { type:'halt' };

type ProgressEvt = LeadEvt | StepEvt | PreviewEvt | HaltEvt;

type JobParams = {
  website?:string;
  regions?:string;
  industries?:string;
  buyers?:string;
  notes?:string;
};

type JobState = {
  id:string;
  params:JobParams;
  em:EventEmitter;
  done:boolean;
  createdAt:number;
};

const JOBS = new Map<string, JobState>();

function newId(prefix:string){ return prefix + randomBytes(6).toString('hex'); }

function mirror(method:'get'|'post','/status'|'/presence/online'|'/presence/beat'|'/vault'|string, handler:any){
  // tiny helper for typed routes
  // @ts-ignore
  app[method](method==='get'?`/api/v1${arguments[1]}`:`/api/v1${arguments[1]}`, handler);
}

/* ===== Status / presence (unchanged behavior) ===== */
mirror('get','/status',(req,res)=>{
  const devUnlimited = req.headers['x-dev-unlim']==='true';
  res.json({
    ok:true,
    uid: String(req.headers['x-galactly-user']||'u-dev'),
    plan: 'free',
    quota: devUnlimited ? { findsUsed:0, revealsUsed:0, findsLeft:Infinity, revealsLeft:Infinity, date: new Date().toISOString().slice(0,10) }
                        : { findsUsed:0, revealsUsed:0, findsLeft:99, revealsLeft:5, date: new Date().toISOString().slice(0,10) },
    devUnlimited
  });
});

let ONLINE = 1;
mirror('get','/presence/online',(_req,res)=>{ ONLINE = Math.max(0, ONLINE); res.json({ total: ONLINE }); });
mirror('post','/presence/beat',(_req,res)=>{ ONLINE = Math.max(1, ONLINE); res.json({ ok:true }); });

/* Vault (just store latest) */
const VAULT = new Map<string, JobParams>();
mirror('post','/vault',(req,res)=>{
  const uid = String(req.headers['x-galactly-user']||'u-dev');
  const body = req.body||{};
  VAULT.set(uid, {
    website:body.website||'',
    regions:body.regions||'',
    industries:body.industries||'',
    buyers:body.buyers||'',
    notes:body.notes||''
  });
  res.json({ ok:true });
});

/* ===== Job system ===== */
function createJob(params:JobParams): JobState {
  const job:JobState = { id: newId('j_'), params, em: new EventEmitter(), done:false, createdAt: Date.now() };
  JOBS.set(job.id, job);
  return job;
}

function endJob(job:JobState){
  job.done = true;
  try { job.em.emit('evt', <HaltEvt>{ type:'halt' }); } catch {}
  setTimeout(()=> JOBS.delete(job.id), 60000);
}

/* ===== Connectors aggregate (real sources go here) =====
   Replace the DEV_FAKE branch with your real async generators.
*/
async function runScan(job:JobState){
  const useFake = String(process.env.DEV_FAKE||'true').toLowerCase()==='true';

  // seed counters
  let i=0;
  const tick = setInterval(()=>{
    const step:StepEvt = {
      type:'step',
      freeDone: Math.min(60, 2*i + 3),
      freeTotal: 1126,
      proDone:  Math.min(840, 14*i + 20),
      proTotal: 1126
    };
    job.em.emit('evt', step);
    if(i%2===0){
      const pv:PreviewEvt = { type:'preview', line: nextPreviewLine(i/2) };
      job.em.emit('evt', pv);
    }
    i++;
  }, 900);

  try{
    if(useFake){
      for await (const ev of aggregateProviders(job.params)) {
  job.em.emit('evt', ev); // ev should be {type:'lead', title, detail, site, state, channel, at}
}
    }else{
      // ===== REAL PIPELINE =====
      // for await (const ev of aggregateProviders(job.params)) job.em.emit('evt', ev);
      // Implement aggregateProviders() with your real connectors (Reddit, RSS, Search, etc.)
    }
  }catch(e){
    // swallow in dev
  }finally{
    clearInterval(tick);
    endJob(job);
  }
}

/* ===== Fake provider (parameterized; disabled when DEV_FAKE=false) ===== */
const US = ['CA','TX','NY','FL','IL','PA','OH','GA','NC','MI','NJ','VA','WA','AZ','MA','TN','IN','MO','MD','WI','MN','CO','AL','SC','LA','KY','OR','OK','CT','UT','IA','NV','AR','MS','KS','NM','NE','WV','ID','HI','ME','NH','MT','RI','DE','SD','ND','AK','DC','VT','WY'];
const CH = ['Email','LinkedIn DM','ERP','SMS','Call'];
const DN = [
  { title:'"Need 10k corrugated boxes"', detail:'RSC • double-wall • 48h turn' },
  { title:'"Quote: 16oz cartons (retail)"', detail:'PDP restock surge' },
  { title:'"Urgent: custom mailers next week"', detail:'Kraft • 2-color • die-cut' },
  { title:'"Pouches 5k/mo"', detail:'8oz / 16oz • matte + zipper' },
  { title:'"Stretch wrap pallets"', detail:'80g • 18" × 1500’' }
];

function nextPreviewLine(n:number){
  const L = [
    'Demand: ad-spend → purchases → “box” tokens',
    'Timing: promo cadence → restock windows',
    'Product: PDP deltas → new pack sizes',
    'Reviews: failure tokens → “crushed”, “leak”',
    'Ops: hiring feed → inbound ops → carton throughput',
    'Finance: turns ↑ → wrap usage ↑'
  ];
  return L[n % L.length];
}

async function* fakeProvider(params:JobParams){
  const site = (params.website||'example.com').replace(/^https?:\/\//,'').replace(/\/.*$/,'');
  for(let k=0;k<16;k++){
    await new Promise(r=>setTimeout(r, 1100 + Math.random()*450));
    const d = DN[(Math.random()*DN.length)|0];
    const ev:LeadEvt = {
      type:'lead',
      site,
      state: US[(Math.random()*US.length)|0],
      channel: CH[(Math.random()*CH.length)|0],
      title: d.title,
      detail: `${d.detail} • ${site}`,
      at: Date.now()
    };
    yield ev;
  }
}

/* ===== Routes using the job system ===== */
mirror('post','/find-now',(req,res)=>{
  const body = (req.body||{}) as JobParams;
  // if you want: validate site, sanitize, etc.
  const job = createJob({
    website: (body.website||'').toString(),
    regions:  (body.regions||'').toString(),
    industries:(body.industries||'').toString(),
    buyers:   (body.buyers||'').toString(),
    notes:    (body.notes||'').toString()
  });
  runScan(job); // fire-and-forget
  res.json({ ok:true, jobId: job.id });
});

mirror('get','/progress.sse',(req,res)=>{
  const jobId = String(req.query.job||'');
  const job = JOBS.get(jobId);
  if(!job){
    res.setHeader('Content-Type','text/event-stream');
    res.write(`data: ${JSON.stringify({ type:'halt' })}\n\n`);
    return res.end();
  }
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');

  const onEvt = (payload:ProgressEvt)=> res.write(`data: ${JSON.stringify(payload)}\n\n`);
  job.em.on('evt', onEvt);

  req.on('close', ()=> job.em.off('evt', onEvt));
});

/* ===== boot ===== */
app.listen(PORT, ()=> console.log(`API listening on ${PORT}`));
