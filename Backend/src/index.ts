// src/index.ts
import express, { Request, Response } from "express";
import cors from "cors";

// IMPORTANT: default-import the Routers so Express receives a middleware function.
// If you flip these to `import * as X`, you'll get "reading 'apply'" again.
import publicRoutes from "./routes/public";
import findRoutes from "./routes/find";
import buyersRoutes from "./routes/buyers";
import webscoutRoutes from "./routes/webscout";

const PORT = Number(process.env.PORT || 8787);

const app = express();

// Allow the free panel to call us cross-origin
app.use(
  cors({
    origin: true,
    credentials: false,
    allowedHeaders: ["Content-Type", "x-api-key"],
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// JSON body parsing
app.use(express.json({ limit: "1mb" }));

// Simple health endpoint for fly.io/railway/etc probes
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));

// Mount routes with clear diagnostics
function safeMount(pathHint: string, router: any, label: string) {
  try {
    if (typeof router !== "function") {
      // Some bundlers put the Router under .default
      if (router?.default && typeof router.default === "function") {
        app.use(router.default);
      } else {
        throw new Error(`module did not export a Router (got ${typeof router})`);
      }
    } else {
      app.use(router);
    }
    console.log(`[routes] mounted ${label} from ${pathHint}`);
  } catch (err) {
    console.error(
      `[routes] failed to mount ${label} from ${pathHint} ${err instanceof Error ? err.stack : err}`
    );
  }
}

// Mount each router exactly once
safeMount("./routes/public", publicRoutes, "public");
safeMount("./routes/find", findRoutes, "find");
safeMount("./routes/buyers", buyersRoutes, "buyers");
safeMount("./routes/webscout", webscoutRoutes, "webscout");

// Default root
app.get("/", (_req, res) => res.status(200).json({ ok: true, service: "animated-cellar" }));

app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
