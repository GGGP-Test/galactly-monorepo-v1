import crypto from 'crypto';

export type TaskKind = 'preview' | 'leads';
export type Task = {
  id: string;
  uid: string;
  kind: TaskKind;
  status: 'pending' | 'running' | 'done' | 'error';
  lines: string[]; // preview text lines
  items: any[];    // lead objects
  error?: string;
};

const tasks = new Map<string, Task>();

export function createTask(uid: string, kind: TaskKind): Task {
  const t: Task = {
    id: 't_' + crypto.randomBytes(8).toString('hex'),
    uid,
    kind,
    status: 'pending',
    lines: [],
    items: [],
  };
  tasks.set(t.id, t);
  return t;
}

export function getTask(id: string) {
  return tasks.get(id);
}

export function addLine(t: Task, s: string) {
  t.lines.push(s);
}

export function addItem(t: Task, v: any) {
  t.items.push(v);
}
