import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import routes from "./routes";

const app = express();

// -------- CORS --------
const originEnv = process.env.CORS_ORIGIN || "";
const allowedOrigins = originEnv
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-api-key",
      "x-client",
      "x-region"
    ],
    credentials: false,
    maxAge: 86400
  })
);

// Handle explicit OPTIONS (preflight)
app.options("*", (_req, res) => res.sendStatus(204));

// -------- Core middleware --------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// -------- API mounting (with prefix aliases) --------
// Canonical prefix:
app.use("/api/v1", routes);

// Alias to tolerate old/new frontend code:
app.use("/api", routes);

// Root health (for platform)
app.get("/", (_req, res) => res.json({ ok: true, name: "buyers-api", status: "up" }));

// 404 JSON
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// Error JSON
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const code = typeof err?.status === "number" ? err.status : 500;
  const message = err?.message || "Internal error";
  res.status(code).json({ ok: false, error: message });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
});