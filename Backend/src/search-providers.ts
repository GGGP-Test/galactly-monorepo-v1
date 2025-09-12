import { createHash } from 'node:crypto';

const nowIso = () => new Date().toISOString();
const normalizeDomain = (d: string) =>
  d.replace(/^https?:\/\//, '').replace(/\/.*/, '').toLowerCase();
const stableHash = (s: string) =>
  createHash('sha256').update(s).digest('hex').slice(0, 12);

type ThrottleFn<TArgs extends unknown[]> = (...args: TArgs) => void;
export function throttle<TArgs extends unknown[]>(fn: (...a: TArgs) => void, ms: number): ThrottleFn<TArgs> {
  let t = 0;
  return (...a: TArgs) => {
    const now = Date.now();
    if (now - t >= ms) {
      t = now;
      fn(...a);
    }
  };
}

export async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  return await r.text();
}

export async function simpleSearch(query: string) {
  const id = stableHash(query + ':' + nowIso());
  return { id, query, results: [] as { url: string; title: string }[] };
}

export { normalizeDomain, nowIso, stableHash };
