import { pool, q } from '../src/db';

function rate(wins:number, pulls:number){ return pulls>0 ? wins/Math.max(1,pulls) : 0.5; }

async function main(){
  // Aggregate success by source_id (only rows that have it)
  const rows=(await q<any>(`
    WITH recent AS (
      SELECT id, source_id
        FROM lead_pool
       WHERE source_id IS NOT NULL
         AND created_at>now()-interval '14 days'
    ),
    conv AS (
      SELECT lead_id, 1 AS owned
        FROM event_log
       WHERE event_type IN ('own','claim')
         AND created_at>now()-interval '14 days'
    )
    SELECT r.source_id, COUNT(*) AS pulls, COALESCE(SUM(c.owned),0) AS wins
      FROM recent r
      LEFT JOIN conv c ON c.lead_id=r.id
     GROUP BY r.source_id`)).rows;

  for(const r of rows){
    const pulls=Number(r.pulls)||0;
    const wins=Number(r.wins)||0;
    const pr=rate(wins,pulls);
    await q('UPDATE source_queries SET priority=$2 WHERE id=$1', [r.source_id, pr]);
  }

  // Keep top N active
  const TOP=60;
  await q(`
    WITH ranked AS (
      SELECT id, priority,
             row_number() OVER (ORDER BY priority DESC, last_success DESC NULLS LAST, id ASC) AS rn
        FROM source_queries
       WHERE kind='cse'
    )
    UPDATE source_queries s
       SET active = CASE WHEN r.rn <= $1 THEN true ELSE false END
      FROM ranked r
     WHERE s.id=r.id`, [TOP]);

  console.log('Bandit update complete.');
}
main().then(()=>pool.end()).catch(e=>{ console.error(e); pool.end(); process.exit(1); });
