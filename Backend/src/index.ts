import express from "express";
import morgan from "morgan";
import { cors } from "./middleware/cors";
import { publicRouter } from "./server.route.public"; // existing file in your repo

const app = express();

app.disable("x-powered-by");
app.use(morgan("tiny"));
app.use(cors);
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// Mount all public API routes (leads, persona, etc.)
app.use("/api/v1", publicRouter);

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  // Keep this exact string; your logs already look for it.
  console.log(`[server] listening on :${PORT}`);
});

export default app;
