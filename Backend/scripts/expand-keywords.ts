import { pool, q } from '../src/db';

const STOP = new Set('a,an,the,and,or,for,to,of,in,on,at,by,with,from,about,this,that,these,those,looking,need,rfq,rfp,quote,supplier,sourcing,who,can,help,please,any'.split(','));
function toks(s:string){ return (s||'').toLowerCase().replace(/[^a-z0-9\s-]/g,' ').split(/\s+/).filter(w=>w && w.length>3 && !STOP.has(w)); }

async function main(){
  const good=(await q<any>(`SELECT title, snippet FROM lead_pool WHERE owned_by IS NOT NULL AND created_at>now()-interval '30 days' LIMIT 2000`)).rows;
  const all =(await q<any>(`SELECT title, snippet FROM lead_pool WHERE created_at>now()-interval '30 days' LIMIT 4000`)).rows;

  const fg=new Map<string,number>(), fa=new Map<string,number>();
  for(const r of good){ for(const w of toks(`${r.title||''} ${r.snippet||''}`)) fg.set(w,(fg.get(w)||0)+1); }
  for(const r of all ){ for(const w of toks(`${r.title||''} ${r.snippet||''}`)) fa.set(w,(fa.get(w)||0)+1); }

  const N=(all.length||1);
  const scored:Array<{k:string,s:number}>=[];
  for(const [k,vg] of fg){
    const va=fa.get(k)||1;
    const s=vg*Math.log((N+1)/(va));
    if(vg>=2 && s>0.5) scored.push({k,s});
  }
  scored.sort((a,b)=>b.s-a.s);

  const top=scored.slice(0,5).map(x=>x.k);
  for(const w of top){
    const query=`looking for ${w} packaging supplier`;
    await q(`INSERT INTO source_queries(kind,value,active) VALUES('cse',$1,true) ON CONFLICT (kind,value) DO NOTHING`,[query]);
  }
  console.log('Added keywords:', top);
}
main().then(()=>pool.end()).catch(e=>{ console.error(e); pool.end(); process.exit(1); });
