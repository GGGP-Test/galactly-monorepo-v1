import * as path from 'node:path';
import * as fs from 'node:fs';

export function here(...parts: string[]) {
  return path.join(process.cwd(), ...parts);
}

export function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
