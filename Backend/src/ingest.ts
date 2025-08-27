import { q } from './db';
export async function runIngest(source: string){
// seed a couple of rows (so /leads is never empty)
const demo = [
['web','https://example.com/rfp/corrugated','County RFQ: Corrugated Boxes','Seeking quotes for corrugated cartons; due in 3 days'],
['reddit','https://reddit.com/r/smallbusiness/demo','Looking for custom mailers','Need 1000 printed mailers ASAP']
];
for(const d of demo){ try{ await q('INSERT INTO lead_pool(platform,source_url,title,snippet) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', d as any); }catch{} }
return { ok:true, inserted: demo.length, source } as const;
}
