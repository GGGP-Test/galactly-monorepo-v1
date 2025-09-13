import express from "express";

// NOTE: routes are plain JS for maximum runtime compatibility with tsx/esbuild
import mountPublic from "./routes/public.js";
import mountBuyers from "./routes/buyers.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Basic request logging (tiny)
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.url}`);
  next();
});

// Mount routes
mountPublic(app);
mountBuyers(app);

// Root ping
app.get("/", (_req, res) => res.status(200).send("ok"));

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
