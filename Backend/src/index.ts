import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

/**
 * Galactly API (dev/free mode, CORS-safe)
 * - No gating, no quotas (devUnlimited true)
 * - CORS configured for cross-origin calls (GitHub Pages etc.)
 */

const app = express();
app.set('trust proxy', 1);

// --- CORS: allow any origin, custom headers, preflight ---
const CORS_OPTS: cors.CorsOptions = {
  origin: (origin, cb) => cb(null, true),      // reflect any origin
  credentials: true,                           // ok for cookies (we don't use them)
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','x-galactly-user','x-dev-unlim','authorization'],
  exposedHeaders: []
};
app.use(cors(CORS_OPTS));
app.options('*', cors(CORS_OPTS));

app.use(express.json({ limit: '1mb' }));

type Method = 'get'|'post'|'put'|'delete';
type Beat = { last: number; role?: string };
type Quota = { date: string; findsUsed: number; revealsUsed: number; findsLeft: number; revealsLeft: number; };
type UserState = { uid: string; plan: 'free'|'pro'; verified?: boolean; quota: Quota; };

const PORT = Number(process.env.PORT || 8787);
const presence = new Map<string, Beat>();
const users = new Map<string, UserState>();
const PRESENCE_TTL = 30_000;
const today = () => new Date().toISOString().slice(0,10);
const uidOf = (req: Request) => (req.header('x-galactly-user') || `u-${randomUUID().toString().replace(/-/g,'').slice(0,12)}`).toString();

function ensureUser(uid: string): UserState {
  const d = today();
  let s = users.get(uid);
  if (!s) {
    s = { uid, plan: 'free', verified: true, quota: { date: d, findsUsed: 0, revealsUsed: 0, findsLeft: 999, revealsLeft: 999 } };
    users.set(uid, s);
  }
  if (s.quota.date !== d) s.quota = { date: d, findsUsed: 0, revealsUsed: 0, findsLeft: 999, revealsLeft: 999 };
  return s;
}

const ROUTES: Array<{method: Method; path: string}> = [];
function reg(m: Method, p: string, h: any){ ROUTES.push({method:m,path:p}); (app as any)[m](p,h); }
function mirror(m: Method, p: string, h: any){ const P=p.startsWith('/')?p:`/${p}`; reg(m,P,h); reg(m,`/api/v1${P}`,h); }

// health / debug
mirror('get','/healthz',(_req,res)=>res.json({ok:true,ts:Date.now()}));
reg('get','/',(_req,res)=>res.json({ok:true,name:'Galactly API',mode:'dev/free',time:Date.now()}));
reg('get','/__routes',(_req,res)=>res.json({ok:true,routes:ROUTES}));

// presence
setInterval(()=>{ const cut=Date.now()-PRESENCE_TTL; for(const [k,v] of presence) if(v.last<cut) presence.delete(k); }, 5_000);
mirror('get','/presence/online',(_req,res)=>{
  let suppliers=0,distributors=0,buyers=0;
  for(const v of presence.values()){
    const r=(v.role||'').toLowerCase();
    if(r==='supplier') suppliers++; else if(r==='distributor'||r==='wholesaler') distributors++; else if(r==='buyer') buyers++;
  }
  res.json({ok:true,total:presence.size,suppliers,distributors,buyers});
});
mirror('post','/presence/beat',(req,res)=>{
  const uid=uidOf(req); const role=String(req.body?.role||'');
  presence.set(uid,{last:Date.now(),role});
  res.json({ok:true});
});

// status (always generous)
mirror('get','/status',(req,res)=>{
  const uid=uidOf(req); const s=ensureUser(uid);
  res.json({
    ok:true, uid, plan:s.plan, verified:true,
    quota:{...s.quota, findsLeft:999, revealsLeft:999},
    devUnlimited:true
  });
});

// gates / vault (no-op)
mirror('post','/gate',(req,res)=>{ const uid=uidOf(req); ensureUser(uid); res.json({ok:true,uid,plan:'free'}); });
mirror('post','/vault',(req,res)=>{ const uid=uidOf(req); ensureUser(uid); res.json({ok:true,uid,saved:true}); });

// find & reveal (never 429)
mirror('post','/find-now',(req,res)=>{ const uid=uidOf(req); ensureUser(uid); res.json({ok:true,created:7,jobId:`job_${Date.now()}`}); });
mirror('post','/reveal',(req,res)=>{ const uid=uidOf(req); ensureUser(uid); res.json({ok:true,revealed:true}); });

// preview SSE
// --- replace the old /progress.sse handler with this one ---
mirror('get','/progress.sse',(req,res)=>{
  // allow a site hint for nicer fake events
  const site = (String(req.query.site || '') || 'example.com').replace(/^https?:\/\//,'').replace(/\/.*$/,'');

  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');

  const send = (obj:any)=> res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // small helper pools to generate believable signals
  const usStates = ['CA','TX','NY','FL','IL','PA','OH','GA','NC','MI','NJ','VA','WA','AZ','MA','TN','IN','MO','MD','WI','MN','CO','AL','SC','LA','KY','OR','OK','CT','UT','IA','NV','AR','MS','KS','NM','NE','WV','ID','HI','ME','NH','MT','RI','DE','SD','ND','AK','DC','VT','WY'];
  const channels = ['Email','LinkedIn DM','ERP','SMS','Call'];
  const demands  = [
    { title:'"Need 10k corrugated boxes"', detail:'RSC • double-wall • 48h turn' },
    { title:'"Quote: 16oz cartons (retail)"', detail:'PDP restock surge' },
    { title:'"Urgent: custom mailers next week"', detail:'Kraft • 2-color • die-cut' },
    { title:'"Pouches 5k/mo"', detail:'8oz / 16oz, matte + zipper' },
    { title:'"Stretch wrap pallets"', detail:'80g • 18" × 1500’' }
  ];
  const previews = [
    { category:'Demand',  text:'ad-spend → purchase spikes → “box” keywords' },
    { category:'Timing',  text:'promo cadence → restock windows (DTC + retail)' },
    { category:'Product', text:'PDP deltas → new pack sizes → SKU rotation' },
    { category:'Reviews', text:'pack failure tokens → “crushed”, “leak”, “tear”' },
    { category:'Ops',     text:'hiring feed → inbound ops → carton throughput' },
    { category:'Finance', text:'inventory notes → turns ↑ → wrap usage ↑' },
  ];

  let i = 0;
  const t = setInterval(()=>{
    // 1) keep the counters moving
    const step = {
      type:'step',
      freeDone: Math.min(60, 2*i + 3),
      freeTotal: 1126,
      proDone:  Math.min(840, 14*i + 20),
      proTotal: 1126
    };
    send(step);

    // 2) every ~1.2s add a preview line (we’ll keep 6 in UI)
    if (i % 2 === 0) {
      const pv = previews[(i/2) % previews.length];
      send({ type:'preview', line: `${pv.category}: ${pv.text}` });
    }

    // 3) every ~2.7s emit a “lead” card
    if (i % 3 === 0) {
      const d  = demands[(Math.random()*demands.length)|0];
      const st = usStates[(Math.random()*usStates.length)|0];
      const ch = channels[(Math.random()*channels.length)|0];
      send({
        type:'lead',
        site,
        state: st,
        channel: ch,
        title: d.title,
        detail: d.detail,
        at: Date.now()
      });
    }

    i++;
    if (i > 40) { send({type:'halt'}); clearInterval(t); res.end(); }
  }, 900);

  req.on('close', ()=> clearInterval(t));
});


// 404
app.use((_req,res)=>res.status(404).json({ok:false,error:'not_found'}));

app.listen(PORT, ()=>console.log(`[api] listening on :${PORT}  MODE=dev/free  CORS=on`));
