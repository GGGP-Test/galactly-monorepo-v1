#!/usr/bin/env node
/**
 * buyers-autofix: bootstrap core repairs + small targeted patches + auto PR label
 * - Runs even if core files are invalid.
 * - Repairs Backend/package.json, Dockerfile, tsconfig.json, src/index.ts when missing/broken.
 * - Optionally asks OpenRouter for small patches; tolerates 404/no-model and continues.
 * - Pushes fix/<ts> branch and opens a PR labeled "autofix" (auto-merge workflow merges it).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// --- geometry (workflow runs with working-directory: Backend)
const repoRoot = path.resolve(process.cwd(), "..");
const B = (...p) => path.join(repoRoot, "Backend", ...p);
const R = (abs) => abs.replace(repoRoot + path.sep, "").replace(/\\/g, "/");

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
  thomasnet: B("src", "connectors", "thomasnet.ts")
};

// allowlist now includes core files
const ALLOW = new Set([
  R(PATHS.pkg), R(PATHS.dockerfile), R(PATHS.tsconfig), R(PATHS.indexTs),
  R(PATHS.leads), R(PATHS.discovery), R(PATHS.pipeline),
  R(PATHS.google), R(PATHS.kompass), R(PATHS.thomasnet)
]);

function rd(p){ return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; }
function ensureDir(p){ fs.mkdirSync(path.dirname(p), { recursive:true }); }
function git(cmd, opts={}){ return execSync(`git ${cmd}`, { stdio:"pipe", encoding:"utf8", ...opts }).trim(); }
function branch(){ return git("rev-parse --abbrev-ref HEAD"); }

function safePackageJson(){
  return JSON.stringify({
    name:"galactly-backend", version:"0.1.0", private:true, type:"module",
    engines:{ node: ">=20" },
    scripts:{ start:"tsx src/index.ts", dev:"tsx watch src/index.ts", smoke:"node scripts/buyers-smoke.mjs" },
    dependencies:{ cors:"^2.8.5", express:"^4.19.2", zod:"^3.23.8" },
    devDependencies:{ "@types/cors":"^2.8.17", "@types/express":"^4.17.21", "@types/node":"^20.11.30", tsx:"^4.19.0", typescript:"^5.6.2" }
  }, null, 2)+"\n";
}
function safeDockerfile(){ return `FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_loglevel=warn
COPY Backend/package*.json ./
RUN npm install --no-audit --no-fund
COPY Backend/. .
EXPOSE 8080
CMD ["npx","tsx","src/index.ts"]
`; }
function safeTsconfig(){ return JSON.stringify({
  compilerOptions:{ target:"ES2020", module:"ES2020", moduleResolution:"bundler", strict:true, esModuleInterop:true, skipLibCheck:true, resolveJsonModule:true, outDir:"dist", types:["node"] },
  include:["src/**/*.ts"], exclude:["node_modules","dist"]
}, null, 2)+"\n"; }
function safeIndexTs(){ return `import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";
const app = express();
app.use(cors());
app.use(express.json({ limit:"1mb" }));
app.get("/healthz", (_req,res)=>res.status(200).json({ok:true}));
app.use("/api/v1/leads", leadsRouter);
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, ()=>console.log(JSON.stringify({msg:"server_started",port:PORT})));
export default app;
`; }

function parseJSONSafe(s){ try{ return JSON.parse(s); }catch{ return null; } }
function readSmoke(){
  const raw = rd(PATHS.smoke1) || rd(PATHS.smoke2);
  return raw ? parseJSONSafe(raw) : null;
}
function shouldAutofix(smoke){
  if (!smoke) return true;
  if (smoke.ok === false) return true;
  if ((smoke.nonDemoCount ?? 0) === 0) return true;
  return false;
}

// ---- bootstrap repairs (no LLM)
function proposeRepairs(){
  const repairs = [];

  // package.json
  const pkgRaw = rd(PATHS.pkg);
  let pkgOk = false;
  if (pkgRaw) { pkgOk = !!parseJSONSafe(pkgRaw); }
  if (!pkgOk) repairs.push({ path:R(PATHS.pkg), content:safePackageJson(), why:"fix package.json" });

  // Dockerfile
  const dRaw = rd(PATHS.dockerfile) || "";
  if (!/node:20/i.test(dRaw) || !/COPY Backend\/\. \./.test(dRaw)) {
    repairs.push({ path:R(PATHS.dockerfile), content:safeDockerfile(), why:"fix Dockerfile" });
  }

  // tsconfig.json
  const tRaw = rd(PATHS.tsconfig);
  if (!tRaw || !parseJSONSafe(tRaw)) {
    repairs.push({ path:R(PATHS.tsconfig), content:safeTsconfig(), why:"fix tsconfig.json" });
  }

  // src/index.ts
  const iRaw = rd(PATHS.indexTs) || "";
  if (!/\/routes\/leads/.test(iRaw)) {
    repairs.push({ path:R(PATHS.indexTs), content:safeIndexTs(), why:"fix index.ts" });
  }

  return repairs;
}

// ---- LLM call with fallback models and hardening
async function callOpenRouter(prompt){
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const models = [
    process.env.OPENROUTER_MODEL,                             // allow override
    "qwen/qwen-2-7b-instruct:free",
    "google/gemma-2-9b-it:free",
    "meta-llama/llama-3.1-8b-instruct:free"
  ].filter(Boolean);

  for (const model of models){
    try{
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method:"POST",
        headers:{
          "content-type":"application/json",
          authorization:`Bearer ${apiKey}`,
          "HTTP-Referer":"https://github.com/",
          "X-Title":"buyers-autofix"
        },
        body: JSON.stringify({
          model,
          messages:[
            { role:"system", content:
`Output STRICT JSON: {"files":[{"path":"...","content":"..."}]}
Touch ONLY files from ALLOWLIST.
Keep patches small; no new deps.
Goal: >=3 non-demo US/CA packaging leads with evidence from free/public sources.` },
            { role:"user", content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 1600
        })
      });
      if (!res.ok){
        const t = await res.text();
        console.log(`[autofix] model ${model} HTTP ${res.status}: ${t}`);
        continue; // try next model
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) continue;
      const match = content.match(/\{[\s\S]*\}$/);
      const jsonText = match ? match[0] : content;
      const parsed = parseJSONSafe(jsonText);
      if (parsed && Array.isArray(parsed.files)) return parsed;
    }catch(e){
      console.log(`[autofix] model ${model} error:`, e?.message || String(e));
      continue;
    }
  }
  return null; // no model worked; proceed with bootstrap-only
}

function buildPrompt(ctx){
  const autonomy = rd(PATHS.autonomy) || "";
  const allow = JSON.stringify([...ALLOW], null, 2);
  return `
AUTONOMY.md
-----------
${autonomy}

ALLOWLIST
---------
${allow}

Smoke
-----
${JSON.stringify(ctx.smoke || {}, null, 2)}

Current files
-------------
--- ${R(PATHS.discovery)} ---
${ctx.discovery}
--- ${R(PATHS.pipeline)} ---
${ctx.pipeline}
--- ${R(PATHS.leads)} ---
${ctx.leads}

Task
----
Improve discovery/pipeline/leads to yield >=3 non-demo US/CA packaging leads with evidence.
Use public directories/search; 1 LLM call per supplier; keep tokens low.
Return STRICT JSON only.`;
}

async function main(){
  const smoke = readSmoke();
  if (!shouldAutofix(smoke)){
    console.log("Autofix not needed; exiting.");
    return;
  }

  // branch
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo){ console.error("GITHUB_REPOSITORY not set"); process.exit(1); }
  const ts = new Date().toISOString().replace(/[:.]/g,"-");
  const br = `fix/${ts}`;
  const base = branch();

  git("config user.name 'buyers-autofix[bot]'");
  git("config user.email 'buyers-autofix[bot]@users.noreply.github.com'");
  git(`checkout -b ${br}`);

  let changed = 0;

  // bootstrap repairs
  for (const r of proposeRepairs()){
    if (!ALLOW.has(r.path)) continue;
    const abs = path.join(repoRoot, r.path);
    ensureDir(abs);
    fs.writeFileSync(abs, r.content, "utf8");
    console.log("bootstrap:", r.path, "-", r.why);
    changed++;
  }

  // LLM patches (optional)
  const ctx = {
    smoke,
    discovery: rd(PATHS.discovery) || "",
    pipeline: rd(PATHS.pipeline) || "",
    leads: rd(PATHS.leads) || ""
  };

  try{
    const resp = await callOpenRouter(buildPrompt(ctx));
    if (resp && Array.isArray(resp.files)){
      for (const f of resp.files){
        if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
        const rel = f.path.replace(/^\.?\/*/,"");
        if (!ALLOW.has(rel)) { console.log("skip (not allowed):", rel); continue; }
        const abs = path.join(repoRoot, rel);
        ensureDir(abs);
        fs.writeFileSync(abs, f.content, "utf8");
        console.log("llm_patch:", rel);
        changed++;
      }
    } else {
      console.log("[autofix] no model patch; continuing with bootstrap changes only.");
    }
  }catch(e){
    console.log("[autofix] LLM call failed; continuing:", e?.message || String(e));
  }

  if (changed === 0){
    const notes = B("AUTOFIX-NOTES.md");
    ensureDir(notes);
    fs.writeFileSync(notes, `# Autofix\nNo changes produced.\nTime: ${new Date().toISOString()}\n`, "utf8");
    changed++;
  }

  git("add -A");
  git(`commit -m "autofix: bootstrap repairs + targeted patches [skip ci]"`);

  const token = process.env.GITHUB_TOKEN;
  if (!token){ console.error("GITHUB_TOKEN not set; cannot push/PR."); process.exit(0); }

  git(`push https://x-access-token:${token}@github.com/${repo}.git HEAD:${br}`, { stdio:"inherit" });

  // open PR + label
  const prBody = {
    title: "buyers-autofix: bootstrap + targeted patches",
    head: br, base,
    body: "Automated PR. Includes bootstrap repairs (core files) and small targeted patches per AUTONOMY.md.",
    maintainer_can_modify: true
  };

  const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method:"POST",
    headers:{ authorization:`Bearer ${token}`, "content-type":"application/json", "user-agent":"buyers-autofix-bot", accept:"application/vnd.github+json" },
    body: JSON.stringify(prBody)
  });
  if (!prRes.ok){ console.error("Failed to open PR:", prRes.status, await prRes.text()); process.exit(1); }
  const pr = await prRes.json();
  console.log("Opened PR:", pr.html_url || pr.number);

  // add 'autofix' label to trigger auto-merge workflow
  await fetch(`https://api.github.com/repos/${repo}/issues/${pr.number}/labels`, {
    method:"POST",
    headers:{ authorization:`Bearer ${token}`, "content-type":"application/json", "user-agent":"buyers-autofix-bot" },
    body: JSON.stringify({ labels: ["autofix"] })
  });

  console.log("Labeled PR with 'autofix'.");
}

main().catch(e => { console.error("autofix failed:", e?.stack || String(e)); process.exit(1); });
