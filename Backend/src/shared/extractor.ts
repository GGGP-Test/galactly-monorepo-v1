// src/shared/extractor.ts
//
// Thin, typed wrappers around the ontology helpers so routes can import
// extractProducts / extractSectors / extractMetrics with stable names.
// All functions are pure and deterministic; no network or globals.

import {
  productsFrom as _productsFrom,
  sectorsFrom as _sectorsFrom,
  metricsBySector as _metricsBySector,
} from "./ontology";

export type MetricMap = Record<string, string[]>;

/** Extract normalized product tags from site text (+ optional meta keywords). */
export function extractProducts(text: string, keywords?: string[]): string[] {
  const t = String(text || "");
  const kw = Array.isArray(keywords) ? keywords : [];
  return _productsFrom(t, kw);
}

/** Extract normalized sector/audience hints from site text (+ optional meta keywords). */
export function extractSectors(text: string, keywords?: string[]): string[] {
  const t = String(text || "");
  const kw = Array.isArray(keywords) ? keywords : [];
  return _sectorsFrom(t, kw);
}

/**
 * Bottom-up hot metrics by sector.
 * Guarantees each mentioned sector has a non-empty list (ontology supplies fallbacks).
 */
export function extractMetrics(
  text: string,
  sectorHints: string[],
  productTags: string[],
): MetricMap {
  const t = String(text || "");
  const sectors = Array.isArray(sectorHints) ? sectorHints : [];
  const products = Array.isArray(productTags) ? productTags : [];
  return _metricsBySector(t, sectors, products);
}

/**
 * Aggregator alias used by some callers; currently just delegates to extractMetrics.
 * Kept separate so we can evolve post-processing (dedupe, cap, rank) without touching routes.
 */
export function aggregateBottomUp(
  text: string,
  sectorHints: string[],
  productTags: string[],
): MetricMap {
  return extractMetrics(text, sectorHints, productTags);
}

export default {
  extractProducts,
  extractSectors,
  extractMetrics,
  aggregateBottomUp,
};