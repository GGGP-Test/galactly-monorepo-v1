// src/routes/public.ts
import type { Express, Request, Response } from "express";
import { Router } from "express";

type Temp = "hot" | "warm";

export interface LeadItem {
  id: string;
  host: string;
  platform?: string;
  title?: string;
  createdAt?: string;
  temp: Temp;
  why?: string;
}

interface LeadsStore {
  hot: LeadItem[];
  warm: LeadItem[];
}

declare global {
  // Fallback store if routes populated a global instead of app.locals
  // (keeps this route compatible without touching other files)
  // eslint-disable-next-line no-var
  var __LEADS: LeadsStore | undefined;
}

function getStore(req: Request): LeadsStore {
  const locals = (req.app.locals as any) || {};
  if (!locals.leadsStore) {
    // initialize empty store once
    locals.leadsStore = { hot: [], warm: [] } as LeadsStore;
    req.app.locals = locals;
  }
  // prefer app.locals, else global
  return (locals.leadsStore as LeadsStore) ?? (globalThis.__LEADS ||= { hot: [], warm: [] });
}

function normalizeRegion(input?: string | string[]) {
  if (!input) return undefined;
  const raw = Array.isArray(input) ? input[0] : input;
  const s = raw.toString().trim().toLowerCase().replace(/[^a-z]/g, "");
  if (s.length === 4) {
    const c = s.slice(0, 2).toUpperCase();
    const st = s.slice(2).toUpperCase();
    return `${c}/${st}`; // e.g., usca -> US/CA
  }
  // accept already formatted values like US/CA, us/ca, etc.
  return raw;
}

export default function mountPublic(app: Express) {
  const r = Router();

  // Health
  r.get("/api/v1/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // Leads list (lenient)
  r.get("/api/v1/leads", (req: Request, res: Response) => {
    try {
      const tempParam = (req.query.temp ?? "hot").toString().toLowerCase();
      const temp: Temp = tempParam === "warm" ? "warm" : "hot";
      // Region is optional; normalize but never reject
      const region = normalizeRegion(req.query.region as any);

      const store = getStore(req);
      const items = (store[temp] ?? []).slice(0, 200); // simple default page size

      // Debug breadcrumbs in server logs to help next-step tuning
      console.log(
        `[public] GET /leads -> 200 temp=${temp} region=${region ?? "n/a"} count=${items.length}`
      );

      return res.status(200).json({ ok: true, items });
    } catch (err: any) {
      console.error("[public] /leads error", err?.stack || err);
      // Never 400 on list; surface as 200 with ok:false so UI shows message but doesn’t break
      return res.status(200).json({ ok: false, error: "failed_to_list_leads" });
    }
  });

  app.use(r);
  console.log("[routes] mounted public (lenient /leads)");
}
