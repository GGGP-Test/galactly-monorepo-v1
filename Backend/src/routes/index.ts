// src/index.ts
import express from "express";
import buyers from "./routes/buyers";
import pub from "./routes/public";
import find from "./routes/find"; // keep your existing file; it should export a Router

const app = express();
const PORT = process.env.PORT || 8787;

// mount order: public (health/CORS/parsers), buyers, find, then any other routes
app.use(pub);
console.log("[routes] mounted public from ./routes/public");

app.use(buyers);
console.log("[routes] mounted buyers from ./routes/buyers");

app.use(find);
console.log("[routes] mounted find from ./routes/find");

app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});