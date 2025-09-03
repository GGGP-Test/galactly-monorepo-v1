import crypto from 'crypto';

export type TaskKind = 'preview' | 'leads';
export type Task = {
  id: string;
  uid: string;
  kind: TaskKind;
  status: 'pending' | 'running' | 'done' | 'error';
  lines: string[];   // preview log lines
  items: any[];      // leads
  error?: string;
};

const tasks = new Map<string, Task>();

export function createTask(uid: string, kind: TaskKind): Task {
  const id = `t_${crypto.randomBytes(8).toString('hex')}`;
  const t: Task = { id, uid, kind, status: 'pending', lines: [], items: [] };
  tasks.set(id, t);
  return t;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

/** tiny helpers used by the runner */
export function appendLine(t: Task, s: string) {
  t.lines.push(s);
}
export function pushItem(t: Task, v: any) {
  t.items.push(v);
}
