import { q } from '../db.js';
const url = new URL('https://www.googleapis.com/customsearch/v1');
url.searchParams.set('key', API_KEY);
url.searchParams.set('cx', cx);
url.searchParams.set('q', qstr);
url.searchParams.set('num', String(Math.min(RESULTS_PER_QUERY, 10)));
try {
const r = await fetch(url.toString());
if (!r.ok) {
console.error('CSE HTTP', r.status, await r.text());
} else {
const data: any = await r.json();
const items: any[] = data.items || [];
for (const it of items) {
const source_url = it.link as string;
if (!source_url) continue;
if (isExcluded(source_url)) continue;
const title = (it.title as string) || null;
const snippet = (it.snippet as string) || null;
if (CSE_REQUIRE_INTENT && !hasIntent(title, snippet)) continue;
const heat = scoreHeat();
try {
const res = await q<{ id: number }>(
`INSERT INTO lead_pool (cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'available')
ON CONFLICT (source_url) DO NOTHING
RETURNING id`,
[null, null, name, 65, heat, source_url, title, snippet, null]
);
if (res.rows[0]?.id) inserted++;
} catch {}
}
}
} catch (e) {
console.error('CSE error', e);
}
await sleep(SLEEP_MS);
}
}
return inserted;
}
