#!/usr/bin/env node
/**
 * buyers-autofix: reads smoke + AUTONOMY.md, asks OpenRouter for SMALL patches,
 * filters to an allowlist, commits on a fix/<timestamp> branch, opens a PR.
 *
 * Env:
 *   OPENROUTER_API_KEY (secret)
 *   GITHUB_TOKEN (Actions token)
 *   GITHUB_REPOSITORY, GITHUB_SHA (provided by Actions)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// --- repo geometry (workflow runs with working-directory: Backend)
const repoRoot = path.resolve(process.cwd(), "..");
const paths = {
  smoke1: path.join(repoRoot, "artifacts", "smoke.json"),
  smoke2: path.join(repoRoot, "artifacts", "run", "smoke.json"),
  autonomy: path.join(repoRoot, "Backend", "AUTONOMY.md"),
  discovery: path.join(repoRoot, "Backend", "src", "buyers", "discovery.ts"),
  pipeline: path.join(repoRoot, "Backend", "src", "buyers", "pipeline.ts"),
  leadsRoute: path.join(repoRoot, "Backend", "src", "routes", "leads.ts"),
  google: path.join(repoRoot, "Backend", "src", "connectors", "google.ts"),
  kompass: path.join(repoRoot, "Backend", "src", "connectors", "kompass.ts"),
  thomasnet: path.join(repoRoot, "Backend", "src", "connectors", "thomasnet.ts"),
};

// --- allowlist (tight on purpose)
const ALLOW = new Set([
  rel(paths.discovery),
  rel(paths.pipeline),
  rel(paths.leadsRoute),
  rel(paths.google),
  rel(paths.kompass),
  rel(paths.thomasnet),
]);

function rel(p) { return p.replace(repoRoot + path.sep, "").replace(/\\/g, "/"); }

function readFirstExisting(...candidates) {
  for (const p of candidates) if (p && fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  return null;
}

function readSmoke() {
  const raw = readFirstExisting(paths.smoke1, paths.smoke2);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function shouldAutofix(smoke) {
  if (!smoke) return true;
  if (smoke.ok === false) return true;
  if (smoke.ok === true && (smoke.empty === true || smoke.nonDemoCount === 0)) return true;
  return false;
}

function git(cmd, opts = {}) {
  return execSync(`git ${cmd}`, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}
function currentBranch() { return git("rev-parse --abbrev-ref HEAD"); }

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
      "X-Title": "buyers-autofix",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content:
`You are a surgical code patcher.
Constraints:
- Output STRICT JSON: {"files":[{"path":"...","content":"..."}]}
- Touch ONLY files listed in "ALLOWLIST".
- Keep changes small. No new deps. Prefer heuristics over LLM calls.
- Goal: return >=3 non-demo US packaging leads with evidence.` },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1600,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim() || "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}$/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : content);
}

function buildPrompt(ctx) {
  const autonomy = readFirstExisting(paths.autonomy) || "";
  const allowlistText = JSON.stringify([...ALLOW], null, 2);
  return `
AUTONOMY (company strategy & guardrails):
<<<AUTONOMY.md>>>
${autonomy}
<<<END AUTONOMY.md>>>

ALLOWLIST (you may ONLY modify these):
${allowlistText}

Smoke summary (if any):
${JSON.stringify(ctx.smoke || {}, null, 2)}

Current files:
--- Backend/src/buyers/discovery.ts ---
${ctx.discovery}
--- Backend/src/buyers/pipeline.ts ---
${ctx.pipeline}
--- Backend/src/routes/leads.ts ---
${ctx.leads}

Task:
Improve discovery/pipeline (and leads route if needed) to yield >=3 non-demo US packaging leads with evidence, using free/public sources, minimal tokens. Keep tokens low; 1 model call per supplier.
Return STRICT JSON only.`;
}

async function main() {
  const smoke = readSmoke();
  if (!shouldAutofix(smoke)) {
    console.log("Autofix not needed; exiting.");
    return;
  }
  const ctx = {
    smoke,
    discovery: fs.existsSync(paths.discovery) ? fs.readFileSync(paths.discovery, "utf8") : "",
    pipeline: fs.existsSync(paths.pipeline) ? fs.readFileSync(paths.pipeline, "utf8") : "",
    leads: fs.existsSync(paths.leadsRoute) ? fs.readFileSync(paths.leadsRoute, "utf8") : "",
  };

  let files = null;
  try {
    files = await callOpenRouter(buildPrompt(ctx));
  } catch (e) {
    console.warn("[autofix] OpenRouter call failed:", e?.message || e);
  }

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) { console.error("GITHUB_REPOSITORY not set"); process.exit(1); }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branch = `fix/${timestamp}`;
  const base = currentBranch();

  git("config user.name 'buyers-autofix[bot]'");
  git("config user.email 'buyers-autofix[bot]@users.noreply.github.com'");
  git(`checkout -b ${branch}`);

  let changed = 0;
  if (files && Array.isArray(files.files)) {
    for (const f of files.files) {
      if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
      const relPath = f.path.replace(/^\.?\/*/, "");
      if (!ALLOW.has(relPath)) { console.log("skip (not allowed):", relPath); continue; }
      const abs = path.join(repoRoot, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content, "utf8");
      console.log("wrote:", relPath);
      changed++;
    }
  }

  if (changed === 0) {
    const notePath = path.join(repoRoot, "Backend", "AUTOFIX-NOTES.md");
    fs.writeFileSync(
      notePath,
      `# Autofix Attempt\n\nNo allowed changes produced.\n\nSmoke:\n\`\`\`json\n${JSON.stringify(smoke || {}, null, 2)}\n\`\`\`\n`,
      "utf8"
    );
    changed++;
  }

  git("add -A");
  git(`commit -m "autofix: small targeted changes per AUTONOMY.md [skip ci]"`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.error("GITHUB_TOKEN not set; cannot push/PR."); process.exit(0); }

  git(`push https://x-access-token:${token}@github.com/${repo}.git HEAD:${branch}`, { stdio: "inherit" });

  const prBody = {
    title: "buyers-autofix: small targeted changes",
    head: branch,
    base,
    body: "Automated PR created by buyers-autofix using AUTONOMY.md and smoke results.",
    maintainer_can_modify: true,
  };

  const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "buyers-autofix-bot",
      accept: "application/vnd.github+json",
    },
    body: JSON.stringify(prBody),
  });

  if (!res.ok) { console.error("Failed to open PR:", res.status, await res.text()); process.exit(1); }
  const pr = await res.json();
  console.log("Opened PR:", pr.html_url || pr.number);
}

main().catch((e) => { console.error("autofix failed:", e?.stack || e); process.exit(1); });
