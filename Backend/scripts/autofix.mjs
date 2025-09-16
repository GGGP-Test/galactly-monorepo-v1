#!/usr/bin/env node
/**
 * buyers-autofix: bootstrap core repairs + small targeted patches + status reporting
 * Provider order: Gemini -> Hugging Face -> Groq -> OpenRouter
 *
 * - Runs even if core files are invalid or smoke artifact is missing.
 * - Repairs Backend/package.json, Dockerfile, tsconfig.json, src/index.ts (no LLM).
 * - Tries free/cheap LLMs in the order above; all are optional.
 *   Env keys (any subset):
 *     GEMINI_API_KEY
 *     HF_API_TOKEN, HF_MODEL (optional, default Qwen2.5-7B-Instruct)
 *     GROQ_API_KEY, GROQ_MODEL (optional, default llama-3.1-8b-instant)
 *     OPENROUTER_API_KEY, OPENROUTER_MODEL (optional, default openrouter/auto)
 * - Opens a PR labeled "autofix" (your auto-merge merges it).
 * - Writes ./autofix-status.json and updates/creates the GitHub Issue "Autonomy Status".
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
  thomasnet: B("src", "connectors", "thomasnet.ts"),
};

const isAllowed = (r) => r.startsWith("Backend/");

// ---------- utils
const rd = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const ensureDir = (p) => fs.mkdirSync(path.dirname(p), { recursive: true });
function parseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function git(cmd) { try { return execSync(`git ${cmd}`, { stdio: "pipe", encoding: "utf8" }).trim(); } catch { return ""; } }
const baseBranch = (() => {
  const b = git("rev-parse --abbrev-ref HEAD");
  return b && b !== "HEAD" ? b : "main";
})();

// ---------- run status (published at end)
const statusPath = path.join(repoRoot, "autofix-status.json");
const RUN = {
  startedAt: new Date().toISOString(),
  provider: "none",
  providersTried: [],
  smokeSeen: false,
  bootstrapChanges: 0,
  llmChanges: 0,
  branch: "",
  prUrl: "",
  result: "started",
  notes: []
};

// ---------- smoke (optional)
function readSmoke() {
  const raw = rd(P.smoke1) || rd(P.smoke2);
  const js = raw ? parseJSON(raw) : null;
  RUN.smokeSeen = !!js;
  return js;
}
function shouldAutofix(smoke) {
  if (!smoke) return true;
  if (smoke.ok === false) return true;
  if ((smoke.nonDemoCount ?? 0) === 0) return true;
  return false;
}

// ---------- core file templates (LLM-free)
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

// ---------- prompt
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
Output STRICT JSON only:
{"files":[{"path":"Backend/...", "content":"..."}]}

Improve discovery/pipeline/leads to yield >=3 non-demo US/CA packaging leads with evidence.
Use public directories/search; 1 LLM call per supplier; keep tokens low.
Do not add new deps or change runtime outside Backend/.
`;
}

// ---------- LLM providers (Gemini -> HF -> Groq -> OpenRouter)
async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  RUN.providersTried.push("gemini");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
  const body = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1400 }
  };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return null;
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const m = text.match(/\{[\s\S]*\}$/);
  const out = parseJSON(m ? m[0] : text);
  if (out && Array.isArray(out.files)) RUN.provider = "gemini";
  return out;
}
async function callHF(prompt) {
  const token = process.env.HF_API_TOKEN;
  if (!token) return null;
  RUN.providersTried.push("huggingface");
  const model = process.env.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct";
  const r = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      inputs: `You are a code patcher. Output STRICT JSON only:
{"files":[{"path":"Backend/...", "content":"..."}]}
Touch only Backend/.
${prompt}`,
      parameters: { max_new_tokens: 1100, temperature: 0.2, return_full_text: false }
    })
  });
  if (!r.ok) return null;
  const data = await r.json();
  const text = Array.isArray(data) ? (data[0]?.generated_text ?? "") : (data?.generated_text ?? data?.[0]?.generated_text ?? "");
  const m = typeof text === "string" ? text.match(/\{[\s\S]*\}$/) : null;
  const out = parseJSON(m ? m[0] : text);
  if (out && Array.isArray(out.files)) RUN.provider = "huggingface";
  return out;
}
async function callGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  RUN.providersTried.push("groq");
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content:
"Output STRICT JSON only: {\"files\":[{\"path\":\"Backend/...\",\"content\":\"...\"}]}\nTouch only Backend/. Keep patches small; no new deps." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1600
    })
  });
  if (!r.ok) return null;
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const m = text.match(/\{[\s\S]*\}$/);
  const out = parseJSON(m ? m[0] : text);
  if (out && Array.isArray(out.files)) RUN.provider = "groq";
  return out;
}
async function callOpenRouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  RUN.providersTried.push("openrouter");
  const model = process.env.OPENROUTER_MODEL || "openrouter/auto";
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://github.com/",
      "X-Title": "buyers-autofix"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content:
"Output STRICT JSON only: {\"files\":[{\"path\":\"Backend/...\",\"content\":\"...\"}]}\nTouch only Backend/. Keep patches small; no new deps." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1600
    })
  });
  if (!r.ok) return null;
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  const m = text.match(/\{[\s\S]*\}$/);
  const out = parseJSON(m ? m[0] : text);
  if (out && Array.isArray(out.files)) RUN.provider = "openrouter";
  return out;
}
async function callAnyModel(prompt) {
  // Order: Gemini -> HF -> Groq -> OpenRouter
  let out = await callGemini(prompt);       if (out && Array.isArray(out.files)) return out;
  out = await callHF(prompt);               if (out && Array.isArray(out.files)) return out;
  out = await callGroq(prompt);             if (out && Array.isArray(out.files)) return out;
  out = await callOpenRouter(prompt);       if (out && Array.isArray(out.files)) return out;
  return null;
}

// ---------- status publishing
function writeStatusFile() {
  const body = { ...RUN, finishedAt: new Date().toISOString() };
  fs.writeFileSync(statusPath, JSON.stringify(body, null, 2));
}
async function upsertStatusIssue() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return;
  const [owner, repoName] = repo.split("/");
  // find existing issue titled "Autonomy Status"
  const list = await fetch(`https://api.github.com/repos/${owner}/${repoName}/issues?state=open&per_page=100`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "buyers-autofix-bot", accept: "application/vnd.github+json" }
  }).then(r => r.ok ? r.json() : []);
  let target = Array.isArray(list) ? list.find(i => i.title === "Autonomy Status") : null;
  const summary = [
    `**Run:** ${new Date().toISOString()}`,
    `**Provider:** ${RUN.provider} (tried: ${RUN.providersTried.join(", ") || "none"})`,
    `**Bootstrap changes:** ${RUN.bootstrapChanges}`,
    `**LLM changes:** ${RUN.llmChanges}`,
    `**Branch:** ${RUN.branch || "-"}`,
    `**PR:** ${RUN.prUrl || "-"}`,
    `**Result:** ${RUN.result}`,
  ].join("\n");
  if (!target) {
    // create
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/issues`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "buyers-autofix-bot" },
      body: JSON.stringify({ title: "Autonomy Status", body: summary, labels: ["autofix"] })
    });
    if (createRes.ok) return;
  } else {
    // comment
    await fetch(`https://api.github.com/repos/${owner}/${repoName}/issues/${target.number}/comments`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "buyers-autofix-bot" },
      body: JSON.stringify({ body: summary })
    });
  }
}
function writeJobSummary() {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  const lines = [
    `### buyers-autofix`,
    `- Provider: **${RUN.provider}** (tried: ${RUN.providersTried.join(", ") || "none"})`,
    `- Bootstrap changes: **${RUN.bootstrapChanges}**`,
    `- LLM changes: **${RUN.llmChanges}**`,
    `- Branch: ${RUN.branch || "-"}`,
    `- PR: ${RUN.prUrl || "-"}`,
    `- Result: **${RUN.result}**`,
  ].join("\n");
  fs.appendFileSync(f, lines + "\n");
}

// ---------- main
async function main() {
  const smoke = readSmoke();
  if (!shouldAutofix(smoke)) {
    RUN.result = "skipped";
    writeStatusFile(); writeJobSummary(); await upsertStatusIssue();
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY || "";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fixBranch = `fix/${ts}`;
  RUN.branch = fixBranch;

  git("config user.name 'buyers-autofix[bot]'");
  git("config user.email 'buyers-autofix[bot]@users.noreply.github.com'");
  git(`checkout -b ${fixBranch}`);

  // 1) bootstrap core repairs
  for (const r of proposeRepairs()) {
    if (!isAllowed(r.path)) continue;
    const abs = path.join(repoRoot, r.path); ensureDir(abs);
    fs.writeFileSync(abs, r.content, "utf8");
    console.log("bootstrap:", r.path, "-", r.why);
    RUN.bootstrapChanges++;
  }

  // 2) optional LLM patches
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
        RUN.llmChanges++;
      }
    } else {
      RUN.notes.push("no LLM patch applied (keys missing/unavailable)");
    }
  } catch (e) {
    RUN.notes.push("LLM step failed: " + (e?.message || String(e)));
  }

  git("add -A");
  git(`commit -m "autofix: bootstrap + targeted patches [skip ci]"`);

  const token = process.env.GITHUB_TOKEN || "";
  if (repo && token) {
    try {
      git(`push https://x-access-token:${token}@github.com/${repo}.git HEAD:${fixBranch}`);
      console.log("pushed:", fixBranch);
      const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`, "content-type": "application/json",
          "user-agent": "buyers-autofix-bot", accept: "application/vnd.github+json"
        },
        body: JSON.stringify({
          title: "buyers-autofix: bootstrap + targeted patches",
          head: fixBranch, base: baseBranch,
          body: "Automated PR. Includes bootstrap repairs and small patches per AUTONOMY.md.",
          maintainer_can_modify: true
        })
      });
      if (prRes.ok) {
        const pr = await prRes.json();
        RUN.prUrl = pr.html_url || "";
        await fetch(`https://api.github.com/repos/${repo}/issues/${pr.number}/labels`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "buyers-autofix-bot" },
          body: JSON.stringify({ labels: ["autofix"] })
        });
      } else {
        RUN.notes.push("PR create failed: " + (await prRes.text()));
      }
    } catch (e) {
      RUN.notes.push("push/PR step failed: " + (e?.message || String(e)));
    }
  } else {
    RUN.notes.push("no repo/token; skipped push/PR");
  }

  RUN.result = "completed";
  writeStatusFile(); writeJobSummary(); await upsertStatusIssue();
  console.log("autofix finished OK.");
}

main().catch(e => {
  RUN.result = "error";
  RUN.notes.push("unexpected: " + (e?.stack || String(e)));
  writeStatusFile(); writeJobSummary(); upsertStatusIssue().finally(() => {});
  // do not throw
});
