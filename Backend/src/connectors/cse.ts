export type CseType = 'web' | 'linkedin' | 'youtube';
const url =
typeof it.link === 'string'
? it.link
: typeof it.formattedUrl === 'string'
? it.formattedUrl
: '';
if (title && url) {
out.push({
source: type,
title,
url,
snippet: typeof it.snippet === 'string' ? it.snippet : undefined,
displayLink: typeof it.displayLink === 'string' ? it.displayLink : undefined,
});
}
}
return out;
}


export function dedupe(items: LeadItem[]): LeadItem[] {
const seen = new Set<string>();
const out: LeadItem[] = [];
for (const it of items) {
const key = it.url.replace(/[#?].*$/, '');
if (!seen.has(key)) {
seen.add(key);
out.push(it);
}
}
return out;
}
