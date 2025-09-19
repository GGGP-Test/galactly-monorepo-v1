export type Persona = {
  offer?: string;
  solves?: string;
  titles?: string;
};

export type SupplierInput = {
  supplier?: string;
  region?: string;      // "us", "ca", "usca", "us/ca"
  radiusMi?: number;
  persona?: Persona;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

export type Candidate = {
  id: string;
  company: string;
  website: string;
  host: string;
  title: string;
  score: number;   // 0..1
  why: string;
  contact?: string;
  email?: string;
};

export type ResponsePayload = {
  created: number;       // count of net-new entities created by discovery (0 for seed/demo)
  candidates: Candidate[];
  inferred?: { supplier?: string; region?: string; radiusMi?: number };
  note?: string;
};

export type Seed = {
  id: string;
  company: string;
  website: string;
  titles: string[];
  regions: string[];   // e.g. ["us", "us-ca"] or ["ca"]
  tags: string[];      // arbitrary domain/tag tokens
};