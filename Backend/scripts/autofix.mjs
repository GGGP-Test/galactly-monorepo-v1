#!/usr/bin/env node
/**
 * buyers-autofix: self-healing + optional LLM with free fallbacks
 * - Runs even if core files are invalid or smoke artifact is missing.
 * - Repairs Backend/package.json, Dockerfile, tsconfig.json, src/index.ts.
 * - Tries providers in this order, if keys exist:
 *     1) HF Inference API  (HF_API_TOKEN, HF_MODEL optional)
 *     2) Google Gemini     (GEMINI_API_KEY)
 *     3) OpenRouter        (OPENROUTER_API_KEY, OPENROUTER_MODEL optional)
 * - Works on detached HEAD; defaults base branch to "main".
 * - Labels PR "autofix" (your auto-merge flow merges it).
 * - Never fails the job; exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// ---------- paths
const repoRoot = path.resolve(process.cwd(), "..");
const B = (...p) => path.join(repoRoot, "Backend", ...p);
const rel = (abs) => abs.replace(repoRoot + path.sep, "").replace(/\\/g, "/");

const P = {
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

// allow everything under Backend (you asked for no restrictions while bootstrapping)
const isAllowed = (r) => r.startsWith("Backend/");

// ---------- utils
const rd = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const ensureDir = (p) => fs.mkdirSync(path.dirname(p), { recursive: true });
function parseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function git(cmd) { try { return execSync(`git ${cmd}`, { stdio: "pipe", encoding: "utf8" }).trim(); } catch { return ""; } }
const baseBranch = git("rev-parse --abbrev-ref HEAD") || "main";

// ---------- smoke (optional)
function readSmoke() { const raw = rd(P.smoke1) || rd(P.smoke2); return raw ? parseJSON(raw) : null; }
function shouldAutofix(smoke) { if (!smoke) return true; if (smoke.ok === false) return true; if ((smoke.nonDemoCount ?? 0) === 0) return true; return false; }

// ---------- core file templates (no-LLM)
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
    dependencies: { cors: "^2.8.5", express: "^4.19.2", zod: "^3.23.8" },
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
ENV npm_config_loglevel=warn
COPY Backend/package*.json ./
RUN npm install --no-audit --no-fund --include=dev
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
    exclude: ["node_modules", "dist"]
  }, null, 2) + "\n";
}
function safeIndexTs() {
  return `import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.get("/healthz", (_req,res)=>res.status(200).json({ok:true}));
app.use("/api/v1/leads", leadsRouter);
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, ()=>console.log(JSON.stringify({msg:"server_started",port:PORT})));
export default app;
`;
}
function proposeRepairs() {
  const fixes = [];
  const pj = rd(P.pkg);          if (!pj || !parseJSON(pj)) fixes.push({ path: rel(P.pkg),        content: safePackageJson(), why: "fix package.json" });
  const df = rd(P.dockerfile)||""; if (!/node:20/i.test(df) || !/COPY Backend\/\. \./.test(df) || !/include=dev/.test(df)) fixes.push({ path: rel(P.dockerfile), content: safeDockerfile(),  why: "fix Dockerfile" });
  const tc = rd(P.tsconfig);     if (!tc || !parseJSON(tc)) fixes.push({ path: rel(P.tsconfig),    content: safeTsconfig(),   why: "fix tsconfig.json" });
  const ix = rd(P.indexTs)||"";  if (!/\/routes\/leads/.test(ix))     fixes.push({ path: rel(P.indexTs),    content: safeIndexTs(),   why: "fix index.ts" });
  return fixes;
}

// ---------- LLM providers (all optional)
// All prompts demand STRICT JSON: {"files":[{"path":"...","content":"..."}]}
function buildPrompt(ctx) {
  const autonomy = rd(P.autonomy) || "";
  return `
AUTONOMY.md
-----------
${autonomy}

ALLOWLIST
---------
Any file under Backend/ (project code).

Smoke
-----
${JSON.stringify(ctx.smoke || {}, null, 2)}

Current files
-------------
--- ${rel(P.discovery)} ---
${ctx.discovery}
--- ${rel(P.pipeline)} ---
${ctx.pipeline}
--- ${rel(P.leads)} ---
${ctx.leads}

Task
----
Improve discovery/pipeline/leads to yield >=3 non-demo US/CA packaging leads with evidence.
Use public directories/search; 1 LLM call per supplier; keep tokens low.
Return STRICT JSON only.`;
}

async function callHF(prompt) {
  const token = process.env.HF_API_TOKEN;
  if (!token) return null;
  const model = process.env.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct";
  const res = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
    method: "POST",
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      inputs:
`You are a code patcher. OUTPUT STRICT JSON ONLY:
{"files":[{"path":"Backend/...", "content":"..."}]}
Touch only files under Backend/.
Goal: >=3 non-demo US/CA packaging leads with evidence from free/public sources.

User prompt:
${prompt}
`,
      parameters: { max_new_tokens: 1100, temperature: 0.2, return_full_text: false }
    })
  });
  if (!res.ok) { console.log("[autofix] HF HTTP", res.status); return null; }
  const data = await res.json();
  const text = Array.isArray(data) ? (data[0]?.generated_text ?? "") : (data?.generated_text ?? data?.[0]?.generated_text ?? "");
  if (typeof text !== "string" || !text.trim()) return null;
  const m = text.match(/\{[\s\S]*\}$/);
  return parseJSON(m ? m[0] : text);
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
  const body = {
    contents: [{
      role: "user",
      parts: [{ text:
`Output STRICT JSON only:
{"files":[{"path":"Backend/...", "content":"..."}]}
Touch only files under Backend/.
Keep patches small; no new deps.

User prompt:
${prompt}` }]
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1400 }
  };
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { console.log("[autofix] Gemini HTTP", res.status); return null; }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const m = text.match(/\{[\s\S]*\}$/);
  return parseJSON(m ? m[0] : text);
}

async function callOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENROUTER_MODEL || "openrouter/auto";
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
`Output STRICT JSON: {"files":[{"path":"Backend/...", "content":"..."}]}
Touch only files under Backend/.
Keep patches small; no new deps; prefer heuristics.` },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1600
    })
  });
  if (!res.ok) { console.log("[autofix] OpenRouter HTTP", res.status); return null; }
  const data = await res.json();
  const c = data?.choices?.[0]?.message?.content?.trim() || "";
  const m = c.match(/\{[\s\S]*\}$/);
  return parseJSON(m ? m[0] : c);
}

async function callAnyModel(prompt) {
  // Try HF → Gemini → OpenRouter. All optional.
  let out = await callHF(prompt);
  if (out && Array.isArray(out.files)) return out;
  out = await callGemini(prompt);
  if (out && Array.isArray(out.files)) return out;
  out = await callOpenRouter(prompt);
  if (out && Array.isArray(out.files)) return out;
  return null;
}

// ---------- main
async function main() {
  const smoke = readSmoke();
  if (!shouldAutofix(smoke)) { console.log("Autofix not needed; exiting 0."); return; }

  const repo = process.env.GITHUB_REPOSITORY || "";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fixBranch = `fix/${ts}`;
  git("config user.name 'buyers-autofix[bot]'");
  git("config user.email 'buyers-autofix[bot]@users.noreply.github.com'");
  git(`checkout -b ${fixBranch}`);

  let changed = 0;

  // 1) Bootstrap core repairs
  for (const r of proposeRepairs()) {
    if (!isAllowed(r.path)) continue;
    const abs = path.join(repoRoot, r.path); ensureDir(abs);
    fs.writeFileSync(abs, r.content, "utf8");
    console.log("bootstrap:", r.path, "-", r.why);
    changed++;
  }

  // 2) Optional LLM patches (free fallbacks first)
  const ctx = {
    smoke,
    discovery: rd(P.discovery) || "",
    pipeline: rd(P.pipeline) || "",
    leads: rd(P.leads) || ""
  };
  try {
    const resp = await callAnyModel(buildPrompt(ctx));
    if (resp && Array.isArray(resp.files)) {
      for (const f of resp.files) {
        if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
        const r = f.path.replace(/^\.?\/*/, "");
        if (!isAllowed(r)) { console.log("skip (not allowed):", r); continue; }
        const abs = path.join(repoRoot, r); ensureDir(abs);
        fs.writeFileSync(abs, f.content, "utf8");
        console.log("llm_patch:", r);
        changed++;
      }
    } else {
      console.log("[autofix] no LLM patch applied (keys missing or providers unavailable).");
    }
  } catch (e) {
    console.log("[autofix] LLM step failed; continuing:", e?.message || String(e));
  }

  if (changed === 0) {
    const notes = B("AUTOFIX-NOTES.md"); ensureDir(notes);
    fs.writeFileSync(notes, `# Autofix\nNo changes produced.\nTime: ${new Date().toISOString()}\n`, "utf8");
  }

  git("add -A");
  git(`commit -m "autofix: bootstrap + optional free-LLM patches [skip ci]"`);

  const token = process.env.GITHUB_TOKEN || "";
  if (repo && token) {
    try { git(`push https://x-access-token:${token}@github.com/${repo}.git HEAD:${fixBranch}`); }
    catch (e) { console.log("push failed (continuing):", e?.message || String(e)); }
    try {
      const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "user-agent": "buyers-autofix-bot",
          accept: "application/vnd.github+json"
        },
        body: JSON.stringify({
          title: "buyers-autofix: bootstrap + optional free-LLM patches",
          head: fixBranch,
          base: baseBranch && baseBranch !== "HEAD" ? baseBranch : "main",
          body: "Automated PR. Includes bootstrap repairs and (if keys present) small patches using HF/Gemini/OpenRouter in that order.",
          maintainer_can_modify: true
        })
      });
      if (prRes.ok) {
        const pr = await prRes.json();
        console.log("Opened PR:", pr.html_url || pr.number);
        await fetch(`https://api.github.com/repos/${repo}/issues/${pr.number}/labels`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "buyers-autofix-bot" },
          body: JSON.stringify({ labels: ["autofix"] })
        });
      } else {
        console.log("PR create failed:", prRes.status, await prRes.text());
      }
    } catch (e) {
      console.log("PR step failed (continuing):", e?.message || String(e));
    }
  } else {
    console.log("no repo/token; skipped push/PR");
  }

  console.log("autofix finished OK.");
}
main().catch(e => { console.log("autofix caught error but exiting 0:", e?.stack || String(e)); });
