export type CseType = 'web' | 'linkedin' | 'youtube';
const type: CseType = (opts.type || 'web');
const limit = Math.max(1, Math.min(opts.limit ?? 10, 10));


const apiKey = env('GOOGLE_API_KEY');
const cx = pickCx(type);
if (!apiKey || !cx || !q) return [];


const u = new URL('https://www.googleapis.com/customsearch/v1');
u.searchParams.set('key', apiKey);
u.searchParams.set('cx', cx);
u.searchParams.set('q', q);
u.searchParams.set('num', String(limit));


const res = await fetch(u.toString());
if (!res.ok) return [];
const data: any = await res.json();
const items: any[] = Array.isArray(data?.items) ? data.items : [];


const out: LeadItem[] = [];
for (const it of items) {
const title: string = typeof it?.title === 'string' ? it.title : '';
const url: string =
typeof it?.link === 'string' ? it.link :
typeof it?.formattedUrl === 'string' ? it.formattedUrl :
'';
if (title && url) {
out.push({
source: type,
title,
url,
snippet: typeof it?.snippet === 'string' ? it.snippet : undefined,
displayLink: typeof it?.displayLink === 'string' ? it.displayLink : undefined,
});
}
}
return out;
}


export function dedupe(items: LeadItem[]): LeadItem[] {
const seen = new Set<string>();
const out: LeadItem[] = [];
for (const it of items) {
const key = (it.url || '').replace(/[#?].*$/, '');
if (!seen.has(key)) { seen.add(key); out.push(it); }
}
return out;
}


// Backwards-compat: admin /poll-now calls pollCSE(); keep a safe no-op here
export async function pollCSE(): Promise<void> { /* no-op for now */ }
