// src/index.ts
import express from "express";
import cors from "cors";
import buyers from "./routes/buyers";
import ingest from "./routes/ingest";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// health + routes overview
const ROUTES: string[] = [];
function reg(method: string, path: string) { ROUTES.push(`${method.toUpperCase()} ${path}`); }

app.get("/healthz", (_req, res) => res.json({ ok: true, msg: "healthy" })); reg("GET", "/healthz");
app.get("/routes", (_req, res) => res.json({ ok: true, routes: ROUTES.sort() })); reg("GET", "/routes");

// existing “compat shim” finders (so the free panel buttons keep working)
function mountCompat(root = "") {
  const base = (p: string) => (root ? `/${root.replace(/^\/+|\/+$/g, "")}${p}` : p);
  const paths = [
    "/leads/find-buyers","/buyers/find-buyers","/find-buyers",
    "/leads/find","/buyers/find","/find",
    "/leads/find-one","/buyers/find-one","/find-one",
  ];
  for (const p of paths) {
    app.get(base(p), buyers.handleFind);  reg("GET", base(p));
    app.post(base(p), buyers.handleFind); reg("POST", base(p));
  }
  app.get(base("/"), (_req, res) => res.json({ ok: true, root: root || "(root)" })); reg("GET", base("/"));
}
mountCompat(""); mountCompat("api"); mountCompat("api/v1"); mountCompat("v1");

// mount ingest API under /api
app.use("/api", ingest); reg("USE", "/api/ingest/*");

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => console.log(`buyers-api listening on :${PORT}`));

export {};