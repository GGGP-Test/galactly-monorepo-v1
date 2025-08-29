// Backend/src/util.ts

// add a tiny sleep helper for polite crawling/scheduling
export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// add minutes to now and return a Date
export const nowPlusMinutes = (m: number) => new Date(Date.now() + m * 60_000);

// ISO helper
export const toISO = (d: Date) => d.toISOString();

// safe hostname extractor (never throws)
export function hostname(u: string): string {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}

// basic clamp
export function clamp(n: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, n));
}

// simple fetch wrapper with UA + timeout and HTML-only guard
export async function fetchHtml(url: string, timeoutMs = 12000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': process.env.BRANDINTAKE_USERAGENT || 'GalactlyBot/0.1 (+https://galactly.dev)' },
      redirect: 'follow',
      signal: ctrl.signal
    } as any);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    return html.slice(0, 250_000); // cap
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
