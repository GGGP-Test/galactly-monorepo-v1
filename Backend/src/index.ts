// Backend/src/index.ts
import express, { Request, Response } from "express";
import cors from "cors";
import { ensureSchema } from "./shared/db";
import { router as leadsRouter } from "./routes/leads";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_: Request, res: Response) => res.json({ ok: true }));

// All app API under /api
app.use("/api", leadsRouter);

const PORT = Number(process.env.PORT || 8787);

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`buyers-api listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Schema init failed:", err);
    process.exit(1);
  });