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
  if (!apiKey || !cx) {
    throw new Error(
      `CSE_MISCONFIG: GOOGLE_API_KEY=${!!apiKey}, CX(${type})=${cx ? "set" : "missing"}`
    );
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", q);
  url.searchParams.set("num", String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`CSE_HTTP_${res.status}: ${txt.slice(0, 400)}`);
  }

  const data: any = await res.json();
  const items: any[] = Array.isArray(data?.items) ? data.items : [];

  return items
    .map((it) => ({
      source: type,
      title: typeof it.title === "string" ? it.title : "",
      url:
        typeof it.link === "string"
          ? it.link
          : typeof it.formattedUrl === "string"
          ? it.formattedUrl
          : "",
      snippet: typeof it.snippet === "string" ? it.snippet : undefined,
      displayLink: typeof it.displayLink === "string" ? it.displayLink : undefined
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
