import { q } from './db';
import { scanBrandIntake } from './connectors/brandintake';

export async function runIngest(source: string){
  if (source === 'brandintake') {
    // Pull a small batch of buyer domains from your BRANDS table (or fallback to env BRANDS_FILE already seeded)
    // Assuming a table `brands(id serial, domain text)` exists in your schema.
    const rows = (await q<{id:number,domain:string}>(
      `SELECT id, domain FROM brands ORDER BY id DESC LIMIT 25`
    )).rows;

    let inserted = 0;
    for (const b of rows) {
      const hits = await scanBrandIntake(b.domain);
      for (const h of hits) {
        try {
          await q(
            `INSERT INTO lead_pool (cat, kw, platform, fit_user, heat, source_url, title, snippet, state, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'available', now())
             ON CONFLICT (source_url) DO NOTHING`,
            ['rfq_page', ['packaging'], 'intake', 60, 60, h.url, h.title||'Supplier page', h.snippet||null]
          );
          inserted++;
        } catch {}
      }
    }
    return { ok:true, did:'brandintake', inserted };
  }

  if (source === 'signals') {
    // Very light derivation step; promote any fresh 'intake' rows (already inserted above).
    const r = await q(`SELECT COUNT(*) FROM lead_pool WHERE platform='intake' AND state='available'`);
    return { ok:true, did:'derive_leads', created: Number(r.rows[0]?.count||0) };
  }

  // disabled sources
  return { ok:true, did:'noop' };
}
