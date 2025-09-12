import express from "express";
import cors from "cors";

export const app = express();
app.use(cors());
app.use(express.json());

// tiny log so we don't need `morgan`
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ---- routes ----
import mountFind from "./routes/find";
import mountBuyers from "./routes/buyers";
import mountWebscout from "./routes/webscout";

mountFind(app);
mountBuyers(app);
mountWebscout(app);

// keep both default and named export to satisfy various imports
export type App = typeof app;
export default app;
