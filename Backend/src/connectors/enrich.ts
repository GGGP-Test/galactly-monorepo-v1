import { q } from '../db.js';


function extractHandle(text: string): string | null {
// very light heuristic for @handle (avoid picking @domain.com)
const re = /(?:^|[^\w])@([a-z0-9_]{3,32})(?!\.[a-z]{2,})/i;
const m = text.match(re);
return m ? `@${m[1]}` : null;
}


export async function enrichLead(leadId: number) {
const row = await q<{ id: number; source_url: string }>(
'SELECT id, source_url FROM lead_pool WHERE id=$1',
[leadId]
);
const sourceUrl = row.rows[0]?.source_url;
if (!sourceUrl) {
return { ok: false, error: 'lead not found' };
}


const controller = new AbortController();
const timeoutMs = Number(process.env.ENRICH_TIMEOUT_MS || 8000);
const t = setTimeout(() => controller.abort(), timeoutMs);


let status = 0, html = '';
try {
const resp = await fetch(sourceUrl, {
signal: controller.signal,
headers: {
'user-agent': 'GalactlyBot/1.0; +https://galactly.com'
}
});
status = resp.status;
html = await resp.text();
} catch (e) {
clearTimeout(t);
await q('UPDATE lead_pool SET last_enriched_at=now(), meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb WHERE id=$1',
[leadId, JSON.stringify({ enriched: false, error: 'fetch', message: String(e) })]);
return { ok: false, error: 'fetch failed' };
}
clearTimeout(t);


// quick harvest
const email = extractEmail(html);
const handle = extractHandle(html);
const meta = { enriched: true, status, bytes: html.length } as any;


await q(
`UPDATE lead_pool
SET contact_email = COALESCE(contact_email, $2),
contact_handle = COALESCE(contact_handle, $3),
meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb,
last_enriched_at = now()
WHERE id = $1`,
[leadId, email, handle, JSON.stringify(meta)]
);


return { ok: true, email, handle };
}
