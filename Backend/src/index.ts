import express from "express";
import cors from "cors";
import { leadsRouter } from "./routes/leads";


const app = express();


// CORS allow-list via env CORS_ORIGIN (comma-separated origins). If unset, allow all (dev).
const corsEnv = (process.env.CORS_ORIGIN || "").trim();
let corsOptions: any;
if (!corsEnv) {
corsOptions = { origin: (_: any, cb: any) => cb(null, true), credentials: true };
} else {
const allowed = corsEnv.split(",").map((s) => s.trim()).filter(Boolean);
corsOptions = {
origin: (origin: string, cb: any) => {
if (!origin || allowed.includes(origin)) return cb(null, true);
return cb(new Error("CORS blocked"), false);
},
credentials: true,
};
}


app.use(cors(corsOptions));
app.use(express.json());


// Basic health + status
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/v1/status", (_req, res) => res.json({ status: "ok" }));


// Leads endpoints
app.use("/api/v1", leadsRouter);


const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`API listening on :${port}`));
