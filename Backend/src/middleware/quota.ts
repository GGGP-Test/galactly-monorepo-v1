// src/middleware/quota.ts
// Compatibility shim: keep old import paths working, but use the new guard.
// Example usage elsewhere:
//   import quota from "../middleware/quota";
//   import { getQuotaStatus } from "../middleware/quota";

export { default } from "./quota-guard";
export { getQuotaStatus, type QuotaOpts } from "./quota-guard";