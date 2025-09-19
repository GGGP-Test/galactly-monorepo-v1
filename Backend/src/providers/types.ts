export type Temp = 'hot' | 'warm';

export interface SupplierPersona {
  offer?: string;
  solves?: string;
  /** Comma-separated titles, e.g., "Purchasing Manager, Procurement Lead" */
  titles?: string;
}

export interface DiscoveryArgs {
  /** Supplier's domain, e.g. "peekpackaging.com" */
  supplier: string;
  /** Region key, e.g. "usca" */
  region: string;
  /** Miles radius (free panel may ignore for now) */
  radiusMi: number;
  persona?: SupplierPersona;
}

export type Platform = 'news' | 'company' | 'directory' | 'social' | 'review';

export interface BuyerCandidate {
  host: string;       // acmefoods.com
  platform: Platform;
  title: string;      // "Purchasing Manager"
  url?: string;
  proof?: string;     // human-readable evidence
  source: string;     // which provider
  createdAt?: string; // ISO
  score?: number;     // 0–100
  temp?: Temp;        // 'hot' | 'warm'
}

export interface DiscoveryResult {
  created: number;
  warm: number;
  hot: number;
  candidates: BuyerCandidate[];
}