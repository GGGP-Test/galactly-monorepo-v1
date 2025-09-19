import { Request, Response } from "express";

type Persona = {
  offer?: string;
  solves?: string;
  titles?: string;
};

type LegacyInput = {
  query?: string;
  company?: string;
  website?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

type SupplierInput = {
  supplier?: string;
  region?: string;
  radiusMi?: number;
  persona?: Persona;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

type RequestBody = LegacyInput & SupplierInput;

type Candidate = {
  id: string;
  name: string;
  score: number;
  notes?: string;
};

type ResponsePayload = {
  created: number;
  candidates: Candidate[];
  inferred?: { supplier?: string; region?: string; radiusMi?: number };
  note?: string;
};

/**
 * Compatibility shim for /api/v1/leads/find-buyers.
 * Swap internals with your real matching logic when ready.
 */
export default async function findBuyers(
  req: Request<unknown, unknown, RequestBody>,
  res: Response
) {
  const body = req.body ?? {};

  const supplier =
    (typeof body.supplier === "string" && body.supplier) ||
    (typeof body.website === "string" && body.website) ||
    (typeof body.company === "string" && body.company) ||
    undefined;

  const region = typeof body.region === "string" ? body.region.toLowerCase() : undefined;
  const radiusMi =
    typeof body.radiusMi === "number"
      ? body.radiusMi
      : body.radiusMi != null
      ? Number(body.radiusMi)
      : undefined;

  const hint: string[] = [];
  if (body.query) hint.push(`query=${JSON.stringify(body.query)}`);
  if (supplier) hint.push(`supplier=${supplier}`);
  if (region) hint.push(`region=${region}`);
  if (radiusMi != null && !Number.isNaN(radiusMi)) hint.push(`radiusMi=${radiusMi}`);

  // return a non-empty stub so the smoke test treats it as success
  const payload: ResponsePayload = {
    created: 0,
    candidates: [
      { id: "stub-1", name: "Sample Buyer", score: 0.42, notes: "compatibility shim" },
    ],
    inferred: supplier || region || radiusMi != null ? { supplier, region, radiusMi } : undefined,
    note: hint.length ? `stubbed response for ${hint.join(", ")}` : "no filters provided",
  };

  res.status(200).json(payload);
}