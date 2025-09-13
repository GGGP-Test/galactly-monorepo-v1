import express, { Application } from "express";
import cors from "cors";
import buyersRouter from "./routes/buyers";
import publicRouter from "./routes/public";

const app: Application = express();

// minimal, safe defaults
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

// health + read-only list endpoints
app.use("/", publicRouter);

// write/find endpoints under a stable prefix
app.use("/api/v1/leads", buyersRouter);

// boot
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});

export default app;