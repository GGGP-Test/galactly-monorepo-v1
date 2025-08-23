import { pool, q } from '../src/db';
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




# ============================================
# FILE: .github/workflows/bandit.yml
# ============================================
name: Bandit Planner
on:
schedule:
- cron: "*/30 * * * *"
workflow_dispatch:


jobs:
bandit:
runs-on: ubuntu-latest
steps:
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
with:
node-version: 20
- run: npm ci || npm install
working-directory: Backend
- name: Update bandit priorities
working-directory: Backend
env:
DATABASE_URL: ${{ secrets.DATABASE_URL }}
run: npx tsx scripts/update-bandit.ts




# ============================================
# FILE: .github/workflows/expand.yml
# ============================================
name: Keyword Expansion
on:
schedule:
- cron: "34 3 * * 1"
workflow_dispatch:


jobs:
expand:
runs-on: ubuntu-latest
steps:
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
with:
node-version: 20
- run: npm ci || npm install
working-directory: Backend
- name: Expand queries
working-directory: Backend
env:
DATABASE_URL: ${{ secrets.DATABASE_URL }}
run: npx tsx scripts/expand-keywords.ts
