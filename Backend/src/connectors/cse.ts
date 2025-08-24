// Google Custom Search connector used by /peek and /leads
snippet?: string;
displayLink?: string;
}


function env(name: string): string | undefined {
const v = process.env[name];
return (v && v.trim()) || undefined;
}


function pickCx(kind: CseType): string | undefined {
if (kind === "linkedin") return env("GOOGLE_CX_LINKEDIN") || env("GOOGLE_CSE_ID");
if (kind === "youtube") return env("GOOGLE_CX_YOUTUBE") || env("GOOGLE_CSE_ID");
return env("GOOGLE_CSE_ID") || env("GOOGLE_CX_WEB") || env("GOOGLE_CX_DEFAULT");
}


export async function cseSearch(params: {
q: string;
type?: CseType;
limit?: number; // Google API returns up to 10 per call
}): Promise<LeadItem[]> {
const { q, type = "web" } = params;
const limit = Math.max(1, Math.min(params.limit ?? 10, 10));


const apiKey = env("GOOGLE_API_KEY");
const cx = pickCx(type);
if (!apiKey || !cx) return [];


const url = new URL("https://www.googleapis.com/customsearch/v1");
url.searchParams.set("key", apiKey);
url.searchParams.set("cx", cx);
url.searchParams.set("q", q);
url.searchParams.set("num", String(limit));


const res = await fetch(url.toString());
if (!res.ok) return [];
const data: any = await res.json();
const items: any[] = Array.isArray(data?.items) ? data.items : [];


return items
.map((it) => ({
source: type,
title: String(it.title ?? ""),
url: String(it.link ?? it.formattedUrl ?? ""),
snippet: it.snippet ? String(it.snippet) : undefined,
displayLink: it.displayLink ? String(it.displayLink) : undefined,
}))
.filter((it) => it.title && it.url);
}


export function dedupe(items: LeadItem[]): LeadItem[] {
const seen = new Set<string>();
const out: LeadItem[] = [];
for (const it of items) {
const key = it.url.replace(/[#?].*$/, "");
if (!seen.has(key)) {
seen.add(key);
out.push(it);
}
}
return out;
}
