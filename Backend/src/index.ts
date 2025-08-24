import express from "express";
import cors from "cors";


const app = express();
app.use(cors());
app.use(express.json());


// --- health ---------------------------------------------------------------
app.get("/healthz", (_req, res) => res.status(200).send("ok"));


// --- minimal API so smoke & probes don’t 500 -----------------------------
app.get("/api/v1/gate", (_req, res) => res.json({ ok: true }));
app.get("/api/v1/status", (_req, res) => res.json({ status: "ok" }));


app.get("/api/v1/admin/queries.txt", (req, res) => {
const token = req.header("x-admin-token");
if (token && process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
return res.status(401).type("text/plain").send("unauthorized\n");
}
// placeholder payload; replace with real data later
res.type("text/plain").send("[]\n");
});


// --- start ---------------------------------------------------------------
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
console.log(`[server] listening on :${PORT}`);
});


export default app;
