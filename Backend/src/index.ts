// src/index.ts
import express from "express";
import cors from "cors";
import buyers from "./routes/buyers";
import ingestGithub from "./routes/ingest-github";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const ROUTES: string[] = [];
function reg(method: string, path: string) { ROUTES.push(`${method.toUpperCase()} ${path}`); }

app.get("/healthz", (_req, res) => res.json({ ok: true, msg: "healthy" })); reg("GET", "/healthz");
app.get("/routes", (_req, res) => res.json({ ok: true, routes: ROUTES.sort() })); reg("GET", "/routes");

// Mount your existing buyers routes (keeps the Free Panel actions working)
app.use("/api", buyers);        reg("USE", "/api/*");

// Mount the new GitHub ingest endpoint
app.use("/api", ingestGithub);  reg("USE", "/api/ingest/*");

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => console.log(`buyers-api listening on :${PORT}`));

export {};