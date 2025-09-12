// src/index.ts
import express, { type Express, type Request, type Response, NextFunction } from "express";

const app: Express = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

// ---- Global CORS (for the panel on github.io) ----
app.use((req: Request, res: Response, next: NextFunction) => {
  // Allow the GitHub Pages UI and other tools; loosen during dev
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Vary", "Origin");
  // Allow custom API key header used by the panel
  res.header("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Fast-path preflight
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Simple health
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// ---- Mount routes (default export OR named fallback) ----
async function mount(modPath: string, fallbackName: string, label: string) {
  try {
    const mod = await import(modPath);
    const fn =
      (mod as any).default ??
      (typeof (mod as any)[fallbackName] === "function" ? (mod as any)[fallbackName] : undefined);
    if (typeof fn === "function") {
      fn(app);
      console.log(`[routes] mounted ${label} from ${modPath}`);
    } else {
      console.warn(`[routes] skipped ${label}: no mount function exported from ${modPath}`);
    }
  } catch (err) {
    console.error(`[routes] failed to mount ${label} from ${modPath}`, err);
  }
}

(async () => {
  await mount("./routes/public", "mountPublic", "public");
  await mount("./routes/find", "mountFind", "find");
  await mount("./routes/buyers", "mountBuyers", "buyers");
  await mount("./routes/webscout", "mountWebscout", "webscout");

  const port = Number(process.env.PORT) || 8787;
  app.listen(port, () => console.log(`[server] listening on :${port}`));
})();
