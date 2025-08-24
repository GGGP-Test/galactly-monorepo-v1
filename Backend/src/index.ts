import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";


// CORS: allow explicit origins (comma-separated), else allow all for now
function makeCors() {
const allow = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!allow.length) return cors({ origin: (_o, cb) => cb(null, true), credentials: true });
return cors({
origin(origin, cb) {
if (!origin || allow.includes(origin)) return cb(null, true);
cb(new Error("CORS blocked: " + origin));
},
credentials: true,
});
}


const app = express();
app.use(express.json());
app.use(makeCors());


app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/v1/status", (_req, res) => res.json({ status: "ok" }));


// mount the leads router at /api/v1
app.use("/api/v1", leadsRouter);


const port = process.env.PORT || 8787;
app.listen(port, () => console.log("API up on", port));
