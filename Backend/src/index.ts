// src/index.ts
import express, { type Express, type Request, type Response, type NextFunction } from "express";

const PORT = Number(process.env.PORT || 8787);

// Allowed UI origins (comma-separated). Default = your GitHub Pages.
const ALLOW = (process.env.CORS_ALLOW_ORIGIN || "https://gggp-test.github.io")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function corsMw(req: Request, res: Response, next: NextFunction) {
  const origin = String(req.headers.origin || "");
  const allowed = ALLOW.includes("*") || (origin && ALLOW.includes(origin));

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  // Methods are fine to always allow
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

  // Reflect *requested* headers so things like x-api-key are accepted.
  const reqHeaders = req.header("access-control-request-headers");
  res.setHeader(
    "Access-Control-Allow-Headers",
    reqHeaders || "Content-Type, Authorization, X-Requested-With, x-api-key"
  );

  // Help caches/CDNs vary correctly and cache preflights for a bit
  res.setHeader("Vary", "Origin, Access-Control-Request-Headers");
  res.setHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

const app = express();
app.use(corsMw);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Safe route mounting (keeps this change single-file)
async function safeMount(path: string, name: string, fnName: string, app: Express) {
  try {
    const mod = await import(path);
    const fn = (mod as any)[fnName] ?? (mod as any).default;
    if (typeof fn === "function") {
      fn(app);
      console.log(`[routes] mounted ${name} from ${path}`);
    } else {
      console.log(`[routes] skipped ${name}: no function export in ${path}`);
    }
  } catch (err: any) {
    console.log(`[routes] not found: ${path} (${err?.message || err})`);
  }
}

(async () => {
  await safeMount("./routes/public", "public", "mountPublic", app);
  await safeMount("./routes/find", "find", "mountFind", app);
  await safeMount("./routes/buyers", "buyers", "mountBuyers", app);
  await safeMount("./routes/webscout", "webscout", "mountWebscout", app);

  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
})();
