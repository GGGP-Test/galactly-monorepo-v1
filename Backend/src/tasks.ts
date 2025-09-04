// Backend/src/source-tasks.ts
// Lightweight in-memory task primitives used by /find-now + /stream.

import { randomBytes } from 'node:crypto';

/** ---------- Event & Lead shapes (match Free Panel) ---------- */
export type PreviewEvent = {
  type: 'counts' | 'metric';
  counts?: { free: number; pro: number };
  metric?: string;
  tier?: 'free' | 'pro';
  score?: number;
  text?: string;
};

export type Lead = {
  title?: string;
  company_domain?: string;
  domain?: string;
  brand?: string;
  state?: string;
  region?: string;
  channel?: string;
  intent?: string;
  reason?: string;
  qty?: string | number;
  material?: string;
  deadline?: string;
  url?: string;
  source?: string;
  locked?: boolean;
};

/** ---------- Task ---------- */
export type Task = {
  id: string;
  userId: string;
  createdAt: number;
  done?: boolean;
  previewQ: PreviewEvent[];
  leadsQ: Lead[];
  /** optional error note for diagnostics (not streamed) */
  error?: string;
};

export type TaskStore = Map<string, Task>;

/** Create an empty store (recommended: one per process) */
export function createTaskStore(): TaskStore {
  return new Map<string, Task>();
}

/** Create a new task for a given user */
export function createTask(userId: string): Task {
  const id = `t_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  return {
    id,
    userId: userId || 'anon',
    createdAt: Date.now(),
    previewQ: [],
    leadsQ: [],
  };
}

/** Insert task into store */
export function putTask(store: TaskStore, task: Task): Task {
  store.set(task.id, task);
  return task;
}

/** Fetch task from store */
export function getTask(store: TaskStore, id: string): Task | undefined {
  return store.get(id);
}

/** Enqueue a preview event */
export function emitPreview(task: Task, ev: PreviewEvent): void {
  task.previewQ.push(ev);
}

/** Enqueue a lead */
export function emitLead(task: Task, lead: Lead): void {
  task.leadsQ.push(lead);
}

/** Mark task done (streamers will end when queues drain) */
export function finishTask(task: Task): void {
  task.done = true;
}

/** Safe helper to normalize comma-separated seeds to bare hosts */
export function parseSeedDomains(raw?: string): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .slice(0, 12);
}
