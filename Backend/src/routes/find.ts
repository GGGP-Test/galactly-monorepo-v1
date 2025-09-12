import type { Application, Request, Response } from "express";

// Minimal shape so the file compiles cleanly.
// We intentionally do not rely on persona/targets here yet.
type FindRequestBody = {
  productOffer?: string;
  solves?: string;
  buyerTitles?: string[];
  supplierDomain?: string;
};

export function mountFind(app: Application) {
  // Stub endpoint to keep the build green. Replace with real implementation later.
  app.post("/api/v1/leads/find", (req: Request<unknown, unknown, FindRequestBody>, res: Response) => {
    return res.status(501).json({ ok: false, error: "find: not implemented yet" });
  });
}

// Export default too, so either import style works.
export default mountFind;
