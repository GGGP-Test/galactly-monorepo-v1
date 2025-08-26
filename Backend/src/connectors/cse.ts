// Google Custom Search connector used by /peek and /leads


export type CseType = "web" | "linkedin" | "youtube";


export interface LeadItem {
source: CseType;
title: string;
url: string;
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
limit?: number; // up to 10 per call
}): Promise<LeadItem[]> {
const { q, type = "web" } = params;
const limit = Math.max(1, Math.min(params.limit ?? 10, 10));
const apiKey = env("GOOGLE_API_KEY");
const cx = pickCx(type);
if (!apiKey || !cx || !q) return [];


const url = new URL("https://www.googleapis.com/customsearch/v1");
url.searchParams.set("key", apiKey);
url.searchParams.set("cx", cx);
url.searchParams.set("q", q);
url.searchParams.set("num", String(limit));


const res = await fetch(url.toString());
if (!res.ok) return [];
const data: any = await res.json();
const items: any[] = Array.isArray(data?.items) ? data.items : [];
  

const out: LeadItem[] = [];
for (const it of items) {
const title = typeof it.title === "string" ? it.title : "";
const url =
typeof it.link === "string"
? it.link
: typeof it.formattedUrl === "string"
? it.formattedUrl
: "";
if (title && url) {
out.push({
source: type,
title,
url,
snippet: typeof it.snippet === "string" ? it.snippet : undefined,
displayLink: typeof it.displayLink === "string" ? it.displayLink : undefined,
});
}
}
return out;
}


// ---------- server-side dedupe + domain filters ----------
function host(u: string): string {
try {
const h = new URL(u).hostname.toLowerCase();
return h.replace(/^www\./, "");
} catch {
return "";
}
}


function listFromEnv(name: string): string[] {
const raw = process.env[name] || "";
return raw
.split(/[,\n\r]+/)
.map((s) => s.trim().toLowerCase())
.filter(Boolean);
}


const BLOCK = new Set(listFromEnv("CSE_BLOCK_DOMAINS"));
const ALLOW = new Set(listFromEnv("CSE_ALLOW_DOMAINS"));
const STRICT = (process.env.CSE_STRICT || "") === "1";


export function serverFilter(items: LeadItem[]): LeadItem[] {
const out: LeadItem[] = [];
const seen = new Set<string>();
for (const it of items) {
const h = host(it.url || it.displayLink || "");
if (!h) continue;
// allowlist strict mode
if (STRICT && ALLOW.size && !ALLOW.has(h) && ![...ALLOW].some((a) => h.endsWith(a))) continue;
// blocklist
if (BLOCK.size && (BLOCK.has(h) || [...BLOCK].some((b) => h.endsWith(b)))) continue;
// dedupe by canonical url (strip hash/query)
const key = (it.url || "").replace(/[?#].*$/, "");
if (seen.has(key)) continue;
seen.add(key);
out.push(it);
}
return out;
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
