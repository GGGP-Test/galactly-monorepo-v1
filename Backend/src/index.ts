import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

// routes
import buyers from "./routes/buyers";
import diagnose from "./routes/diagnose";

const app = express();
app.disable("x-powered-by");

// middleware (no app.options anywhere)
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// health
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

// api
app.use("/api/v1/leads", buyers);
app.use("/api/v1/leads", diagnose);

// start
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`[server] listening on :${port}`);
});