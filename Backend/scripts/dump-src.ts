// Backend/scripts/dump-src.ts
import { promises as fs } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', 'src');      // Backend/src
const OUT  = path.resolve(__dirname, '..', 'src-dump.txt');

// which extensions to include
const EXT = new Set(['.ts', '.json', '.sql']);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (EXT.has(path.extname(entry.name))) yield p;
  }
}

(async () => {
  const parts: string[] = [];
  for await (const file of walk(ROOT)) {
    const rel = path.relative(path.resolve(__dirname, '..'), file).replace(/\\/g, '/');
    const text = await fs.readFile(file, 'utf8');
    parts.push(`\n\n// FILE: ${rel}\n\n${text}`);
  }
  await fs.writeFile(OUT, parts.join('\n'), 'utf8');
  console.log('Wrote', OUT);
})();
