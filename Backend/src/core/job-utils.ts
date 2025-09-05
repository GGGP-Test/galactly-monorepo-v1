// src/core/job-utils.ts
/**
 * Small utilities for job orchestration: backoff, guards, and progress helpers.
 */

export interface BackoffOpts {
  base?: number; // multiplicative base
  min?: number; // ms
  max?: number; // ms
  jitter?: number; // 0..1
}

export function backoffMs(attempt: number, opts: BackoffOpts = {}) {
  const base = opts.base ?? 2;
  const min = opts.min ?? 100;
  const max = opts.max ?? 30_000;
  const jitter = opts.jitter ?? 0.5;
  const pure = Math.min(max, Math.max(min, Math.pow(base, attempt) * min));
  const j = (Math.random() * 2 - 1) * jitter * pure;
  return Math.max(min, pure + j);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function once<T extends (...args: any[]) => any>(fn: T): T {
  let called = false;
  let val: any;
  return ((...args: any[]) => {
    if (!called) {
      called = true;
      val = fn(...args);
    }
    return val;
  }) as T;
}

export function toError(e: any) {
  return e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
}
