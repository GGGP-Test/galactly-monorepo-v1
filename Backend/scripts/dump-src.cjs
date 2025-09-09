// CommonJS dump script (works even if some parent has "type":"module")
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
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (!ignore.has(name)) yield* walk(full);
    } else if (keepExt.has(path.extname(name))) {
      yield full;
    }
  }
}

if (!fs.existsSync(SRC_ROOT)) {
  console.error(`No src/ found at: ${SRC_ROOT}`);
  process.exit(1);
}

let out = `# Dump created ${new Date().toISOString()}\n`;
for (const abs of walk(SRC_ROOT)) {
  const rel = abs.replace(REPO_ROOT + path.sep, '').replace(/\\/g, '/');
  const text = fs.readFileSync(abs, 'utf8');
  out += `\n\n/* ===== ${rel} ===== */\n${text}\n`;
}
fs.writeFileSync(OUT_FILE, out);
console.log(`Wrote ${OUT_FILE}`);
