import type { VendorProfile } from './types';


// Lightweight metric registry (deterministic order). This is used to
// drive the right‑pane preview rail and to emit structured progress events.


export type Rule = {
id: string;
name: string; // shown to user (generic, non‑replicable wording)
bucket: 'Demand' | 'Movement' | 'Procurement' | 'Timing';
estSec: number; // display only; UI pacing uses this
description?: string;
};


export const RULES: Rule[] = [
// Demand (ads/traffic signals)
{ id: 'd1', name: 'Paid Reach Pulse', bucket: 'Demand', estSec: 6, description: 'Estimate paid reach intensity from public signals.' },
{ id: 'd2', name: 'Creative Cadence', bucket: 'Demand', estSec: 5 },
{ id: 'd3', name: 'Region Spread', bucket: 'Demand', estSec: 4 },
{ id: 'd4', name: 'Audience Refresh', bucket: 'Demand', estSec: 4 },
{ id: 'd5', name: 'Burst vs Always‑On', bucket: 'Demand', estSec: 3 },


// Movement (catalog & stock motion)
{ id: 'm1', name: 'New Variant Drift', bucket: 'Movement', estSec: 6 },
{ id: 'm2', name: 'Bundle / Case Patterns', bucket: 'Movement', estSec: 6 },
{ id: 'm3', name: 'Size/Pack Convergence', bucket: 'Movement', estSec: 5 },
{ id: 'm4', name: 'Restock Rhythm', bucket: 'Movement', estSec: 6 },
{ id: 'm5', name: 'Retailer Shelf Additions', bucket: 'Movement', estSec: 7 },


// Procurement (supplier signals)
{ id: 'p1', name: 'Vendor Intake Page', bucket: 'Procurement', estSec: 4 },
{ id: 'p2', name: 'Terms / Forms Change', bucket: 'Procurement', estSec: 4 },
{ id: 'p3', name: 'ESG / Compliance Update', bucket: 'Procurement', estSec: 4 },
{ id: 'p4', name: 'Cert Re‑verification', bucket: 'Procurement', estSec: 3 },
{ id: 'p5', name: 'RFQ Trace', bucket: 'Procurement', estSec: 5 },


// Timing (purchase windows; condensed from your 30)
{ id: 't1', name: 'Quarter‑Close Spike', bucket: 'Timing', estSec: 8 },
{ id: 't2', name: 'Seasonal Launch Slot', bucket: 'Timing', estSec: 7 },
{ id: 't3', name: 'Promo Lift Window', bucket: 'Timing', estSec: 6 },
{ id: 't4', name: 'New Door Onboarding', bucket: 'Timing', estSec: 7 },
{ id: 't5', name: 'Ops Stress (Backlog)', bucket: 'Timing', estSec: 6 },
];


export function buildPlan(vendor: VendorProfile) {
// Reorder a little based on vendor’s industries/regions to feel bespoke
const bias = (r: Rule) => {
const inds = (vendor.industries || []).join(' ').toLowerCase();
if (inds.includes('beverage') && (r.id === 'm2' || r.id === 'm4')) return -1; // bring pack sizes/restock earlier
if (inds.includes('industrial') && r.bucket === 'Procurement') return -1;
return 0;
};
return [...RULES].sort((a,b)=>bias(a)-bias(b));
}
