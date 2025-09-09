// CommonJS dump script: runs with plain `node`
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT  = path.join(REPO_ROOT, 'src');
const OUT_FILE  = path.join(REPO_ROOT, 'dump-src.txt');

const keepExt = new Set(['.ts', '.tsx', '.js', '.json', '.sql', '.md']);
const ignore  = new Set(['node_modules', 'dist', '.git', '.github']);

function* walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel  = path.relative(REPO_ROOT, full);
    const st   = fs.statSync(full);
    if (st.isDirectory()) {
      if (!ignore.has(name)) yield* walk(full);
    } else if (keepExt.has(path.extname(name))) {
      yield rel;
    }
  }
}

let out = `# Dump created ${new Date().toISOString()}\n`;
if (fs.existsSync(SRC_ROOT)) {
  for (const rel of walk(SRC_ROOT)) {
    const full = path.join(REPO_ROOT, rel);
    const text = fs.readFileSync(full, 'utf8');
    out += `\n\n/* ===== ${rel.replace(/\\/g, '/')} ===== */\n${text}\n`;
  }
  fs.writeFileSync(OUT_FILE, out);
  console.log(`Wrote ${OUT_FILE}`);
} else {
  console.error(`No src/ found at ${SRC_ROOT}`);
  process.exit(1);
}
