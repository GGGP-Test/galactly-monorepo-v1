// src/shared/env.ts
// Small, typed helpers for reading environment variables safely.
// Works with noImplicitAny & strict mode.

function hasValue(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Return a string env var or the fallback (undefined allowed). */
export function strEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return hasValue(v) ? v : fallback;
}

/** Return a number (int) env var or fallback. Clamps to finite numbers. */
export function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = Number.parseInt(hasValue(v) ? v : "", 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Return a number (float) env var or fallback. */
export function floatEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = Number.parseFloat(hasValue(v) ? v : "");
  return Number.isFinite(n) ? n : fallback;
}

/** Parse common boolean spellings; default to fallback when unset/unknown. */
export function boolEnv(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (!hasValue(v)) return fallback;
  switch (v.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

/**
 * Split a CSV env var into a trimmed string array.
 * - Empty/absent -> copies of fallback
 * - Dedup optional (off by default)
 */
export function listEnv(
  name: string,
  fallback: string[] = [],
  sep = ",",
  dedup = false,
): string[] {
  const raw = process.env[name];
  if (!hasValue(raw)) return [...fallback];

  const parts: string[] = raw
    .split(sep)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  if (!dedup) return parts;

  const seen = new Set<string>();
  for (const s of parts) seen.add(s);
  return Array.from(seen);
}

/**
 * Constrain a string env var to a fixed set of allowed values.
 * Matching is case-insensitive; returns fallback if unset/invalid.
 */
export function enumEnv<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = process.env[name];
  if (!hasValue(v)) return fallback;

  const want = v.trim().toLowerCase();
  const found = allowed.find((a) => a.toLowerCase() === want);
  return (found ?? fallback) as T;
}