// Concatenate repo source into one file for sharing/debugging
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT  = path.join(REPO_ROOT, 'src');
const OUT_FILE  = path.join(REPO_ROOT, 'dump-src.txt');

const keep = new Set(['.ts', '.tsx', '.js', '.json', '.sql', '.md']);
const ignoreDirs = new Set(['node_modules', 'dist', '.git']);

function* walk(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(REPO_ROOT, full);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!ignoreDirs.has(name)) yield* walk(full);
    } else {
      if (keep.has(path.extname(name))) yield rel;
    }
  }
}

let output = `# Dump created ${new Date().toISOString()}\n`;
for (const rel of walk(SRC_ROOT)) {
  const full = path.join(REPO_ROOT, rel);
  const content = fs.readFileSync(full, 'utf8');
  output += `\n\n/* ===== ${rel.replace(/\\/g, '/')} ===== */\n${content}\n`;
}
fs.writeFileSync(OUT_FILE, output);
console.log(`Wrote ${OUT_FILE}`);
