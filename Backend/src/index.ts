import express from "express";
import { mountLeads } from "./routes/leads";

const app = express();
app.use(express.json());

// tiny health/ping so you can tell if the new image is live
app.get("/api/v1/ping", (req, res) => res.json({ ok: true, pong: true, time: new Date().toISOString() }));
app.get("/healthz", (req, res) => res.send("ok"));

mountLeads(app);

// Northflank typically injects PORT
const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[packlead] runtime up on :${port}`);
});

export default app;
