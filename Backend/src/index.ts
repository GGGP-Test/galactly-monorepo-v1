import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";


function parseOrigins(list?: string | undefined): string[] | null {
if (!list) return null;
const v = list
.split(",")
.map((s) => s.trim())
.filter(Boolean);
return v.length ? v : null;
}


const allowList = parseOrigins(process.env.CORS_ORIGIN);


const app = express();
app.use(express.json());
app.use(
cors({
origin: (origin, cb) => {
if (!allowList) return cb(null, true); // allow all if not set
if (!origin) return cb(null, true); // server-to-server
return cb(null, allowList.includes(origin));
},
credentials: true,
})
);


app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/v1/status", (_req, res) => res.json({ status: "ok" }));


app.use("/api/v1", leadsRouter);


const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
console.log("API up on", port);
});
