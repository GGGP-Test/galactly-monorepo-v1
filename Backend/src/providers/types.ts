export type Temp = 'hot' | 'warm';

export interface SupplierPersona {
  offer?: string;
  solves?: string;
  /** Comma-separated titles, e.g. "Purchasing Manager, Procurement Lead" */
  titles?: string;
}

export interface DiscoveryArgs {
  /** Supplier's domain, e.g. "peekpackaging.com" */
  supplier: string;
  /** Region key, e.g. "usca" */
  region: string;
  /** Radius miles (not enforced in this demo providers set) */
  radiusMi: number;
  persona?: SupplierPersona;
}

export type Platform = 'news' | 'company' | 'directory' | 'social' | 'review';

export interface BuyerCandidate {
  host: string;          // acmefoods.com
  platform: Platform;
  title: string;         // e.g. "Purchasing Manager"
  url?: string;          // optional proof URL
  proof?: string;        // human-readable evidence
  source: string;        // which provider produced it
  createdAt?: string;    // ISO timestamp
  score?: number;        // 0–100
  temp?: Temp;           // 'hot' | 'warm'
}

export interface DiscoveryResult {
  created: number;
  warm: number;
  hot: number;
  candidates: BuyerCandidate[];
}