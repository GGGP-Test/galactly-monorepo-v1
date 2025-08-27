import { q } from '../db';
export async function enrichLead(id: number){
await q('UPDATE lead_pool SET last_enriched_at=now() WHERE id=$1', [id]);
return { ok:true, id };
}
