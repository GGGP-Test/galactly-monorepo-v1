// Backend/src/index.ts
import express from "express";
import cors, { CorsOptionsDelegate } from "cors";

// Try to use morgan if it exists, but don't crash if it doesn't.
let useMorgan: any = null;
(async () => {
  try {
    const m = await import("morgan");
    useMorgan = m.default || m;
  } catch {
    // morgan is optional; ignore if not installed
  }
})();

// IMPORTANT: import the public router as a DEFAULT export,
// so we don't depend on a named export shape.
import publicRouter from "./server.route.public";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

// --- CORS: allow x-api-key so Free Panel preflight succeeds ---
const allowAll: CorsOptionsDelegate = (_req, cb) =>
  cb(null, {
    origin: true, // reflect request origin
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
    credentials: false,
    maxAge: 86400,
  });

app.options("*", cors(allowAll));
app.use(cors(allowAll));

// Optional request logging
if (useMorgan) {
  app.use(useMorgan("tiny"));
}

// Health
app.get("/healthz", (_req, res) => res.status(200).send("OK"));

// Mount all public API routes
// (Your server.route.public.ts should compose /api/v1/persona, /api/v1/leads/*, etc.)
app.use("/", publicRouter);

// Basic error guard so the process doesn't crash silently
// (keeps container "green" and returns structured errors)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || 500;
  const payload = {
    ok: false,
    error: err?.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
  };
  res.status(status).json(payload);
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on :${PORT}`);
});

export default app;
