#!/usr/bin/env node
/**
 * buyers-autofix: self-healing + LLM patches
 *
 * What it does:
 * 1) Bootstrap repair BEFORE calling any model:
 *    - Detects broken/missing core files and writes safe defaults:
 *      Backend/package.json, Backend/Dockerfile, Backend/tsconfig.json, Backend/src/index.ts
 * 2) Reads smoke + AUTONOMY.md + key source files.
 * 3) Calls OpenRouter for SMALL patches to improve discovery/pipeline/leads.
 * 4) Writes changes on fix/<timestamp> branch and opens a PR.
 *
 * No npm install. Runs on Node 20 only.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// --- geometry (Actions runs with working-directory: Backend)
const repoRoot = path.resolve(process.cwd(), "..");
const B = (...p) => path.join(repoRoot, "Backend", ...p);

const PATHS = {
  smoke1: path.join(repoRoot, "artifacts", "smoke.json"),
  smoke2: path.join(repoRoot, "artifacts", "run", "smoke.json"),
  autonomy: B("AUTONOMY.md"),
  pkg: B("package.json"),
  dockerfile: B("Dockerfile"),
  tsconfig: B("tsconfig.json"),
  indexTs: B("src", "index.ts"),
  leads: B("src", "routes", "leads.ts"),
  discovery: B("src", "buyers", "discovery.ts"),
  pipeline: B("src", "buyers", "pipeline.ts"),
  google: B("src", "connectors", "google.ts"),
  kompass: B("src", "connectors", "kompass.ts"),
  thomasnet: B("src", "connectors", "thomasnet.ts"),
};

// allowlist (we now include core files so the bot can self-heal)
const ALLOW = new Set([
  rel(PATHS.pkg),
  rel(PATHS.dockerfile),
  rel(PATHS.tsconfig),
  rel(PATHS.indexTs),
  rel(PATHS.leads),
  rel(PATHS.discovery),
  rel(PATHS.pipeline),
  rel(PATHS.google),
  rel(PATHS.kompass),
  rel(PATHS.thomasnet),
]);

function rel(p) { return p.replace(repoRoot + path.sep, "").replace(/\\/g, "/"); }
function rd(p) { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; }

function readSmoke() {
  const raw = rd(PATHS.smoke1) || rd(PATHS.smoke2);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function shouldAutofix(smoke) {
  if (!smoke) return true;                  // run proactively
  if (smoke.ok === false) return true;      // API failed
  if (smoke.nonDemoCount === 0) return true;// only demo results
  return false;
}

// ---------- Bootstrap repair (no LLM) ----------
function safePackageJson() {
  return JSON.stringify({
    name: "galactly-backend",
    version: "0.1.0",
    private: true,
    type: "module",
    engines: { node: ">=20" },
    scripts: {
      start: "tsx src/index.ts",
      dev: "tsx watch src/index.ts",
      smoke: "node scripts/buyers-smoke.mjs"
    },
    dependencies: {
      cors: "^2.8.5",
      express: "^4.19.2",
      zod: "^3.23.8"
    },
    devDependencies: {
      "@types/cors": "^2.8.17",
      "@types/express": "^4.17.21",
      "@types/node": "^20.11.30",
      tsx: "^4.19.0",
      typescript: "^5.6.2"
    }
  }, null, 2) + "\n";
}
function safeDockerfile() {
  return `FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_loglevel=warn
COPY Backend/package*.json ./
RUN npm install --no-audit --no-fund
COPY Backend/. .
EXPOSE 8080
CMD ["npx","tsx","src/index.ts"]
`;
}
function safeTsconfig() {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ES2020",
      moduleResolution: "bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      outDir: "dist",
      types: ["node"]
    },
    include: ["src/**/*.ts"],
    exclude: ["node_modules","dist"]
  }, null, 2) + "\n";
}
function safeIndexTs() {
  return `import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
app.use("/api/v1/leads", leadsRouter);
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(JSON.stringify({ msg: "server_started", port: PORT })));
export default app;
`;
}

function validateAndProposeRepairs() {
  const repairs = [];

  // package.json
  let pkgOk = false;
  const pkgRaw = rd(PATHS.pkg);
  if (pkgRaw) {
    try { JSON.parse(pkgRaw); pkgOk = true; } catch { pkgOk = false; }
  }
  if (!pkgOk) {
    repairs.push({ path: rel(PATHS.pkg), content: safePackageJson(), reason: "bootstrap:fix package.json" });
  }

  // Dockerfile
  const dockerRaw = rd(PATHS.dockerfile) || "";
  if (!/node:20/i.test(dockerRaw) || !/COPY Backend\/\. \./.test(dockerRaw)) {
    repairs.push({ path: rel(PATHS.dockerfile), content: safeDockerfile(), reason: "bootstrap:fix Dockerfile" });
  }

  // tsconfig.json
  const tsconfRaw = rd(PATHS.tsconfig);
  let tsOk = false;
  if (tsconfRaw) { try { JSON.parse(tsconfRaw); tsOk = true; } catch { tsOk = false; } }
  if (!tsOk) {
    repairs.push({ path: rel(PATHS.tsconfig), content: safeTsconfig(), reason: "bootstrap:fix tsconfig.json" });
  }

  // src/index.ts
  const idxRaw = rd(PATHS.indexTs) || "";
  if (!/\/routes\/leads/.test(idxRaw)) {
    repairs.push({ path: rel(PATHS.indexTs), content: safeIndexTs(), reason: "bootstrap:fix index.ts" });
  }

  return repairs;
}

// ---------- Git helpers ----------
function git(cmd, opts = {}) {
  return execSync(`git ${cmd}`, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}
function currentBranch() { return git("rev-parse --abbrev-ref HEAD"); }

// ---------- LLM ----------
async function callOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/",
      "X-Title": "buyers-autofix"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content:
`You are a surgical code patcher.
Constraints:
- Output STRICT JSON: {"files":[{"path":"...","content":"..."}]}
- Touch ONLY files from the ALLOWLIST.
- Keep changes small; no new deps; prefer heuristics over LLM.
Goal: Return >=3 non-demo US/CA packaging leads with evidence from free/public sources.` },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1600
    })
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim() || "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}$/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : content);
}

function buildPrompt(ctx) {
  const autonomy = rd(PATHS.autonomy) || "";
  const allow = JSON.stringify([...ALLOW], null, 2);
  return `
AUTONOMY.md
-----------
${autonomy}

ALLOWLIST
---------
${allow}

Smoke (if any)
--------------
${JSON.stringify(ctx.smoke || {}, null, 2)}

Current files
-------------
--- ${rel(PATHS.discovery)} ---
${ctx.discovery}
--- ${rel(PATHS.pipeline)} ---
${ctx.pipeline}
--- ${rel(PATHS.leads)} ---
${ctx.leads}

Task
----
Improve discovery/pipeline/leads to yield >=3 non-demo US/CA packaging leads with evidence.
Use public directories/search; keep tokens low; 1 LLM call per supplier.
Return STRICT JSON only.`;
}

// ---------- main ----------
async function main() {
  const smoke = readSmoke();
  if (!shouldAutofix(smoke)) {
    console.log("Autofix not needed; exiting.");
    return;
  }

  // Prepare branch
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) { console.error("GITHUB_REPOSITORY not set"); process.exit(1); }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branch = `fix/${timestamp}`;
  const base = currentBranch();

  git("config user.name 'buyers-autofix[bot]'");
  git("config user.email 'buyers-autofix[bot]@users.noreply.github.com'");
  git(`checkout -b ${branch}`);

  let changed = 0;

  // 1) Bootstrap repairs (no LLM)
  const repairs = validateAndProposeRepairs();
  for (const r of repairs) {
    if (!ALLOW.has(r.path)) continue;
    const abs = path.join(repoRoot, r.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, r.content, "utf8");
    console.log("bootstrap:", r.path, "-", r.reason);
    changed++;
  }

  // 2) LLM small patches (optional)
  const ctx = {
    smoke,
    discovery: rd(PATHS.discovery) || "",
    pipeline: rd(PATHS.pipeline) || "",
    leads: rd(PATHS.leads) || ""
  };

  try {
    const resp = await callOpenRouter(buildPrompt(ctx));
    if (resp && Array.isArray(resp.files)) {
      for (const f of resp.files) {
        if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
        const p = f.path.replace(/^\.?\/*/, "");
        if (!ALLOW.has(p)) { console.log("skip (not allowed):", p); continue; }
        const abs = path.join(repoRoot, p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.content, "utf8");
        console.log("llm_patch:", p);
        changed++;
      }
    }
  } catch (e) {
    console.warn("[autofix] OpenRouter call failed, proceeding with bootstrap-only:", e?.message || e);
  }

  if (changed === 0) {
    // Ensure a commit exists so the workflow has an artifact of intent
    const notes = B("AUTOFIX-NOTES.md");
    fs.writeFileSync(notes, `# Autofix\nNo changes produced.\nTime: ${new Date().toISOString()}\n`, "utf8");
    changed++;
  }

  git("add -A");
  git(`commit -m "autofix: bootstrap repairs + targeted patches [skip ci]"`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.error("GITHUB_TOKEN not set; cannot push/PR."); process.exit(0); }

  git(`push https://x-access-token:${token}@github.com/${repo}.git HEAD:${branch}`, { stdio: "inherit" });

  // Open PR
  const prBody = {
    title: "buyers-autofix: bootstrap + targeted patches",
    head: branch,
    base,
    body: "Automated PR. Includes bootstrap repairs (core files) and small targeted patches per AUTONOMY.md.",
    maintainer_can_modify: true
  };

  const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "buyers-autofix-bot",
      accept: "application/vnd.github+json"
    },
    body: JSON.stringify(prBody)
  });

  if (!res.ok) { console.error("Failed to open PR:", res.status, await res.text()); process.exit(1); }
  const pr = await res.json();
  console.log("Opened PR:", pr.html_url || pr.number);
}

main().catch((e) => { console.error("autofix failed:", e?.stack || e); process.exit(1); });
