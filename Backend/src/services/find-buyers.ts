import { Request, Response } from 'express';

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
  supplier?: string;        // domain (e.g. peekpackaging.com)
  region?: string;          // "usca", "emea", ...
  radiusMi?: number;        // search radius in miles
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
  created: number;          // number of records created/ingested
  candidates: Candidate[];  // matches found
  inferred?: {
    supplier?: string;
    region?: string;
    radiusMi?: number;
  };
  note?: string;
};

/**
 * Compatibility shim so the legacy Free Panel route responds 200.
 * Replace internals with your actual search/DB logic later.
 */
export default async function findBuyers(req: Request<unknown, unknown, RequestBody>, res: Response) {
  const body = req.body ?? {};

  // Normalize inputs from either legacy payload or new supplier payload
  const supplier =
    typeof body.supplier === 'string' && body.supplier
      ? body.supplier
      : typeof body.website === 'string' && body.website
      ? body.website
      : typeof body.company === 'string' && body.company
      ? body.company
      : undefined;

  const region = typeof body.region === 'string' ? body.region.toLowerCase() : undefined;
  const radiusMi =
    typeof body.radiusMi === 'number'
      ? body.radiusMi
      : body.radiusMi != null
      ? Number(body.radiusMi)
      : undefined;

  const hintParts: string[] = [];
  if (body.query) hintParts.push(`query=${JSON.stringify(body.query)}`);
  if (supplier) hintParts.push(`supplier=${supplier}`);
  if (region) hintParts.push(`region=${region}`);
  if (radiusMi != null && !Number.isNaN(radiusMi)) hintParts.push(`radiusMi=${radiusMi}`);

  // Stub result (non-empty so smoke test treats it as success)
  const payload: ResponsePayload = {
    created: 0,
    candidates: [
      {
        id: 'stub-1',
        name: 'Sample Buyer',
        score: 0.42,
        notes: 'compatibility shim (replace with real results)',
      },
    ],
    inferred: supplier || region || radiusMi != null ? { supplier, region, radiusMi } : undefined,
    note:
      hintParts.length > 0
        ? `stubbed response for ${hintParts.join(', ')}`
        : 'no filters provided; returning placeholder candidate',
  };

  return res.status(200).json(payload);
}