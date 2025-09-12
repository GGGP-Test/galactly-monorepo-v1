import type { Application } from "express";

// Named exporters
import { mountBuyers } from "./buyers";
import { mountFind } from "./find";

// Default exporter
import mountWebscout from "./webscout";

// If you have other mounts (leads, public, admin, etc.), add them here using
// their actual export shapes. Keep arity = (app) only.

export default function mountAll(app: Application) {
  // Keep one-arg calls; earlier errors were from passing 2 args
  mountFind(app);
  mountBuyers(app);
  mountWebscout(app);
}
