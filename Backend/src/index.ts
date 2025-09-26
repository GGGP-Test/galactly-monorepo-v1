import express, { type Express, type Request, type Response } from "express";

// Optional logger; safe if not installed in prod image
let morgan: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  morgan = require("morgan");
} catch {
  /* morgan is optional */
}

// Your routers, matching the code you pasted
import LeadsRouter from "./routes/leads";          // exports a Router instance
import PrefsRouterFactory from "./routes/prefs";   // default export = () => Router
import CatalogRouter from "./routes/catalog";      // exports a Router instance

const app: Express = express();
app.disable("x-powered-by");
app.use(express.json());
if (morgan) app.use(morgan("tiny"));

// Inline /health so we don’t depend on routes/health export shape
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// Mount the routers per their actual shapes
app.use(LeadsRouter);
app.use("/api/prefs", PrefsRouterFactory()); // factory returns a Router
app.use(CatalogRouter);

// Simple root
app.get("/", (_req: Request, res: Response) =>
  res.status(200).json({ ok: true, service: "buyers-api" })
);

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api listening on :${PORT}`);
});

export default app;