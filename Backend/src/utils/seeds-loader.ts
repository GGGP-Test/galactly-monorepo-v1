import { readFile } from 'node:fs/promises';

export async function loadSeeds(path: string): Promise<string[]> {
  const txt = await readFile(path, 'utf8');
  return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
