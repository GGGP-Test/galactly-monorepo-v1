// src/index.ts
import express from "express";
import cors from "cors";

import leads from "./routes/leads";              // <-- default export (fixes: no exported member 'leads')
import { ensureSchema } from "./shared/db";      // <-- correct path (fixes: cannot find module './db')

const PORT = Number(process.env.PORT || 8787);

async function main() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // health
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // api
  app.use("/api", leads);

  // make sure DB schema exists before serving traffic
  try {
    await ensureSchema();
    // eslint-disable-next-line no-console
    console.log("DB schema ready");
  } catch (err) {
    // don’t crash; keep serving /healthz so Northflank can roll logs
    // eslint-disable-next-line no-console
    console.error("ensureSchema failed:", err);
  }

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`buyers-api listening on :${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal startup error:", err);
  process.exit(1);
});

export {};