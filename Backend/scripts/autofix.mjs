#!/usr/bin/env node
/**
 * buyers-autofix: bootstrap core repairs + small targeted patches + resilient PR
 * - Runs even if core files are invalid or smoke artifact is missing.
 * - Repairs Backend/package.json, Dockerfile, tsconfig.json, src/index.ts when missing/broken.
 * - Tries OpenRouter with fallbacks; if models unavailable, still proceeds.
 * - Works on detached HEAD (uses base=main by default).
 * - Never fails the job: exits 0 even if PR API errors.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// ---- paths (workflow runs with working-directory: Backend)
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

// Allow any file *inside* Backend to change (you asked for no tight limits).
function isAllowed(r) { return r.startsWith("Backend/"); }

// ---- tiny utils
const rd = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const ensureDir = (p) => fs.mkdirSync(path.dirname(p), { recursive: true });
function git(cmd) {
  try {
    const out = execSync(`git ${cmd}`, { stdio: "pipe", encoding: "utf8" });
    return typeof out === "string" ? out.trim() : "";
  } catch {
    return "";
  }
}
const baseBranch = process.env.AUTOFIX_BASE || git("rev-parse --abbrev-ref HEAD") || "main";

// ---- smoke (optional)
function parseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function readSmoke() {
  const raw = rd(P.smoke1) || rd(P.smoke2);
  return raw ? parseJSON(raw) : null;
}
function shouldAutofix(smoke) {
  if (!smoke) return true;
  if (smoke.ok === false) return true;
  if ((smoke.nonDemoCount ?? 0) === 0) return true;
  return false;
}

// ---- bootstrap repairs (no LLM)
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
app.get("/healthz", (_req,res) => res.status(200).json({ ok: true }));
app.use("/api/v1/leads", leadsRouter);
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(JSON.stringify({ msg:"server_started", port: PORT })));
export default app;
`;
}
function proposeRepairs() {
  const repairs = [];
  // package.json
  const pj = rd(P.pkg);
  if (!pj || !parseJSON(pj)) repairs.push({ path: rel(P.pkg), content: safePackageJson(), why: "fix package.json" });
  // Dockerfile
  const df = rd(P.dockerfile) || "";
  if (!/node:20/i.test(df) || !/COPY Backend\/\. \./.test(df)) {
    repairs.push({ path: rel(P.dockerfile), content: safeDockerfile(), why: "fix Dockerfile" });
  }
  // tsconfig
  const tc = rd(P.tsconfig);
  if (!tc || !parseJSON(tc)) repairs.push({ path: rel(P.tsconfig), content: safeTsconfig(), why: "fix tsconfig.json" });
  // index.ts
  const ix = rd(P.indexTs) || "";
  if (!/\/routes\/leads/.test(ix)) repairs.push({ path: rel(P.indexTs), content: safeIndexTs(), why: "fix index.ts" });
  return repairs;
}

// ---- LLM call with model fallbacks (tolerate 404s)
async function callOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const models = [
    process.env.OPENROUTER_MODEL,
    "openrouter/auto",                    // generic router
    "google/gemma-2-9b-it:free",
    "qwen/qwen-2-7b-instruct:free"
  ].filter(Boolean);

  for (const model of models) {
    try {
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
`Output STRICT JSON: {"files":[{"path":"...","content":"..."}]}
Only modify files under 'Backend/'.
Keep patches small; no new deps; prefer heuristics over LLM.
Goal: >=3 non-demo US/CA packaging leads with evidence from free/public sources.` },
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 1600
        })
      });
      if (!res.ok) { console.log(`[autofix] model ${model} HTTP ${res.status}`); continue; }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) continue;
      const match = content.match(/\{[\s\S]*\}$/);
      const jsonText = match ? match[0] : content;
      const parsed = parseJSON(jsonText);
      if (parsed && Array.isArray(parsed.files)) return parsed;
    } catch (e) {
      console.log(`[autofix] model ${model} error:`, e?.message || String(e));
    }
  }
  return null;
}

function buildPrompt(ctx) {
  const autonomy = rd(P.autonomy) || "";
  const allow = "Any file under Backend/ (project code).";
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

async function main() {
  const smoke = readSmoke();
  if (!shouldAutofix(smoke)) {
    console.log("Autofix not needed; exiting 0.");
    return;
  }

  // prepare branch (safe on detached HEAD)
  const repo = process.env.GITHUB_REPOSITORY || "";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fixBranch = `fix/${ts}`;
  git("config user.name 'buyers-autofix[bot]'");
  git("config user.email 'buyers-autofix[bot]@users.noreply.github.com'");
  git(`checkout -b ${fixBranch}`);

  let changed = 0;

  // 1) bootstrap repairs
  for (const r of proposeRepairs()) {
    if (!isAllowed(r.path)) continue;
    const abs = path.join(repoRoot, r.path);
    ensureDir(abs);
    fs.writeFileSync(abs, r.content, "utf8");
    console.log("bootstrap:", r.path, "-", r.why);
    changed++;
  }

  // 2) LLM patches (optional)
  const ctx = {
    smoke,
    discovery: rd(P.discovery) || "",
    pipeline: rd(P.pipeline) || "",
    leads: rd(P.leads) || ""
  };
  try {
    const resp = await callOpenRouter(buildPrompt(ctx));
    if (resp && Array.isArray(resp.files)) {
      for (const f of resp.files) {
        if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
        const r = f.path.replace(/^\.?\/*/, "");
        if (!isAllowed(r)) { console.log("skip (not allowed):", r); continue; }
        const abs = path.join(repoRoot, r);
        ensureDir(abs);
        fs.writeFileSync(abs, f.content, "utf8");
        console.log("llm_patch:", r);
        changed++;
      }
    } else {
      console.log("[autofix] no model patch; continuing with bootstrap changes only.");
    }
  } catch (e) {
    console.log("[autofix] LLM call failed; continuing:", e?.message || String(e));
  }

  if (changed === 0) {
    // ensure commit
    const notes = B("AUTOFIX-NOTES.md");
    ensureDir(notes);
    fs.writeFileSync(notes, `# Autofix\nNo changes produced.\nTime: ${new Date().toISOString()}\n`, "utf8");
  }

  git("add -A");
  git(`commit -m "autofix: bootstrap repairs + targeted patches [skip ci]"`);
  // push branch (best effort)
  const token = process.env.GITHUB_TOKEN || "";
  if (repo && token) {
    try {
      git(`push https://x-access-token:${token}@github.com/${repo}.git HEAD:${fixBranch}`);
      console.log("pushed:", fixBranch);
    } catch (e) {
      console.log("push failed (continuing):", e?.message || String(e));
    }
  } else {
    console.log("no repo/token; skipped push");
  }

  // open PR (best effort) + label
  if (repo && token) {
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
          title: "buyers-autofix: bootstrap + targeted patches",
          head: fixBranch,
          base: baseBranch && baseBranch !== "HEAD" ? baseBranch : "main",
          body: "Automated PR. Includes bootstrap repairs (core files) and small targeted patches per AUTONOMY.md.",
          maintainer_can_modify: true
        })
      });
      if (prRes.ok) {
        const pr = await prRes.json();
        console.log("Opened PR:", pr.html_url || pr.number);
        // add label to trigger auto-merge workflow
        await fetch(`https://api.github.com/repos/${repo}/issues/${pr.number}/labels`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "user-agent": "buyers-autofix-bot"
          },
          body: JSON.stringify({ labels: ["autofix"] })
        });
        console.log("Labeled PR with 'autofix'.");
      } else {
        console.log("PR create failed:", prRes.status, await prRes.text());
      }
    } catch (e) {
      console.log("PR step failed (continuing):", e?.message || String(e));
    }
  }

  // always succeed
  console.log("autofix finished OK.");
}

main().catch((e) => {
  console.log("autofix caught error but exiting 0:", e?.stack || String(e));
});
