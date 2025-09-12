import * as path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const DB_FILE = path.join(process.cwd(), 'data.json');

export async function readJson<T>(fallback: T): Promise<T> {
  try {
    const raw = await readFile(DB_FILE, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(value: T): Promise<void> {
  await writeFile(DB_FILE, JSON.stringify(value, null, 2));
}
