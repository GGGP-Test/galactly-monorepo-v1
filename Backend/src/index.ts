import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "buyers-api", message: "Hello from Backend!" });
});

app.get("/healthz", (_req, res) => {
  // keep it boring so the container healthcheck always passes when the process is alive
  res.status(200).json({ ok: true });
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[buyers-api] listening on :${PORT}`);
});