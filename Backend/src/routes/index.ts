import { Router, Request, Response } from "express";

/**
 * Flexible routes index.
 * If a concrete leads router exists (./leads or ./buyers), export that.
 * Otherwise, export a tiny placeholder that keeps the app compiling/running.
 *
 * We export both `default` and a couple of named aliases so whichever
 * import style the app uses, it won't break.
 */

const fallback = Router();

// Minimal “it works” endpoint (helps smoke-test mounting)
fallback.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, hint: "routes/index mounted", ns: "leads" });
});

async function resolveRouter(): Promise<any> {
  // Try common filenames in order
  for (const p of ["./leads", "./buyers"]) {
    try {
      const mod: any = await import(p);
      const candidate =
        mod?.default ?? mod?.router ?? mod?.routes ?? mod?.leads ?? mod?.buyersRouter;
      if (candidate && typeof candidate === "function") {
        return candidate;
      }
    } catch {
      // ignore and try next
    }
  }
  return fallback;
}

const routerPromise = resolveRouter();

const proxy = Router();
// Defer all requests to the resolved router once available.
// This keeps export synchronous while still resolving at runtime.
proxy.use(async (req, res, next) => {
  try {
    const real = await routerPromise;
    return real(req, res, next);
  } catch (e) {
    return next(e);
  }
});

// Export under multiple names to be import-proof
export default proxy;
export const router = proxy;
export const routes = proxy;
export const leads = proxy;
export const buyersRouter = proxy;