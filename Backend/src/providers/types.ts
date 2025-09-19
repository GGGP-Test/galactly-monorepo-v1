// Backend/src/providers/types.ts

export type Temp = "hot" | "warm";

export interface Candidate {
  host: string;
  platform?: string;  // "web" | "news" | etc.
  title?: string;
  why?: string;
  temp?: Temp;
}

export interface FindBuyersInput {
  supplier: string;         // supplier domain, e.g. "peekpackaging.com"
  region: string;           // "usca", "us", "ca", etc.
  radiusMi: number;
  persona: {
    offer: string;
    solves: string;
    titles: string;         // CSV e.g. "Purchasing Manager, Buyer"
  };
}

export interface ProviderResult {
  name: string;
  candidates: Candidate[];
  debug?: Record<string, unknown>;
}