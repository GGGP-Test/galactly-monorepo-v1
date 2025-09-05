// Hard guard: avoid very large packaging suppliers.
// We still allow large BUYERS (brands), but not large PACKAGING suppliers.

import { LeadFeatures } from "./lead-features";

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export interface GuardPolicy {
  maxRevenueUSD: number;     // e.g., 50_000_000
  maxEmployees: number;      // e.g., 200
}

export const DEFAULT_GUARD: GuardPolicy = {
  maxRevenueUSD: 50_000_000,
  maxEmployees: 200,
};

export function guardLeadSize(lead: LeadFeatures, policy = DEFAULT_GUARD): GuardResult {
  const { core } = lead;

  // If it's a packaging supplier, enforce the cap strictly.
  if (core.isPackagingSupplier) {
    if ((core.revenueUSD ?? 0) > policy.maxRevenueUSD)
      return { allowed: false, reason: "supplier_too_large_revenue" };
    if ((core.employees ?? 0) > policy.maxEmployees)
      return { allowed: false, reason: "supplier_too_large_employees" };
  }
  return { allowed: true };
}
