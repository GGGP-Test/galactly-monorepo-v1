import express type { Express, Request, Response } from "express";

const app: Express = express();
app.disable("x-powered-by");
app.use(express.json());

// Optional request logger: works if present, silently skipped if not
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const morgan = require("morgan");
  if (morgan) app.use(morgan("tiny"));
} catch {
  /* morgan is optional at runtime */
}

/**
 * Load a route "registrar" module that exports either:
 *   - named:  export function registerX(app: Express) { ... }
 *   - default: export default function (app: Express) { ... }
 * and then invoke it with `app`.
 */
function useRegistrar(modulePath: string, candidateNames: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod: any = require(modulePath);
  const fn =
    candidateNames.map((n) => mod?.[n]).find(Boolean) ??
    mod?.default;

  if (typeof fn === "function") {
    fn(app);
  }
}

// Always present
useRegistrar("./routes/health", ["registerHealth"]);

// Tolerate either named or default exports in these modules
useRegistrar("./routes/leads", ["registerLeads"]);
useRegistrar("./routes/prefs", ["registerPrefs"]);

// Simple root for smoke checks
app.get("/", (_req: Request, res: Response) =>
  res.status(200).json({ ok: true, service: "buyers-api" })
);

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api listening on :${PORT}`);
});

export default app;