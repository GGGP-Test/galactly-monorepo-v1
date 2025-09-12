// src/ai/metric-dictionary.ts
// Canonical packaging metrics + lightweight trigger phrases.
// Expand here freely; engine will auto-use anything you add.

export interface MetricDef {
  key: string;             // short code
  label: string;           // human readable
  desc: string;            // 1-line description
  triggers: string[];      // phrases that indicate this pressure/need
}

export const METRICS: MetricDef[] = [
  {
    key: "DCS",
    label: "Distributed fulfillment (3PL/DC heavy)",
    desc: "Buyer runs multiple DCs/3PLs, cares about throughput + standardization.",
    triggers: [
      "3pl","fulfillment","distribution center","multi-node","dc","node",
      "ship from store","sfs","wms","warehouse network","omnichannel"
    ]
  },
  {
    key: "ILL",
    label: "Irregular/mixed loads",
    desc: "Non-square pallets, heterogeneous cases, unstable stacks.",
    triggers: [
      "mixed pallet","irregular load","non square","odd size","assorted",
      "unstable","heterogeneous","case mix","palletizing challenges"
    ]
  },
  {
    key: "RPI",
    label: "Right-size / DIM-weight pressure",
    desc: "Small-parcel cost pressure; right-sizing/corrugate optimization.",
    triggers: [
      "dim weight","dimensional weight","right size","cartonization",
      "small parcel","carrier surcharge","zone skipping","rate shop"
    ]
  },
  {
    key: "CCI",
    label: "Cold chain integrity",
    desc: "Refrigerated/frozen shipments; thermal/insulated packaging.",
    triggers: [
      "cold chain","refrigerated","frozen","insulated","thermal",
      "phase change","vaccine","perishable","temperature control"
    ]
  },
  {
    key: "FEI",
    label: "Fragility/ISTA compliance",
    desc: "Breakage risk; drop/shock protection; lab testing/ISTA.",
    triggers: [
      "ista","drop test","shock","fragile","breakage","cushion",
      "void fill","foam-in-place","pulp","air pillow"
    ]
  },
  {
    key: "AUTO",
    label: "Automation readiness",
    desc: "Conveyor, wrappers, carton erectors, palletizers.",
    triggers: [
      "automation","palletizer","pre-stretch","turntable","infeed",
      "conveyor","semi-automatic","automatic","throughput"
    ]
  },
  {
    key: "SUS",
    label: "Sustainability/EPR",
    desc: "Recycled content, lightweighting, EPR compliance.",
    triggers: [
      "recycled content","recyclable","compostable","epr","lightweight",
      "reduce material","less plastic","post-consumer","pcw"
    ]
  },
  {
    key: "LABEL",
    label: "Labeling & traceability",
    desc: "High volumes of shipping/lot labels; scan reliability matters.",
    triggers: [
      "labeling","barcode","thermal transfer","gs1","lot traceability",
      "serialization","print and apply","rfid"
    ]
  },
  {
    key: "FOOD",
    label: "Food & beverage format",
    desc: "Cased beverage, multipack, can/bottle, shrink/bundle.",
    triggers: [
      "bottling","brewery","beverage","casing","multipack","bundling",
      "tray shrink","sleeve","haccp"
    ]
  },
  {
    key: "PHARMA",
    label: "Pharma/medical compliance",
    desc: "GxP/ISO, cleanroom, tamper-evident, pedigree.",
    triggers: [
      "gxp","gmp","iso 13485","cleanroom","tamper evident",
      "pedigree","serialization","21 cfr part 11"
    ]
  }
];

// Simple list of generic role/title terms we like to seed into queries.
export const DEFAULT_TITLES = [
  "purchasing manager","warehouse manager","operations manager","supply chain manager",
  "procurement","vp operations","plant manager","logistics manager"
];
