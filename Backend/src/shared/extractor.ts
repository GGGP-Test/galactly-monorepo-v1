// src/shared/extractor.ts
//
// Stable facade over ./ontology so routes can import either the old
// names (productsFrom, sectorsFrom, metricsBySector) or the new
// names (extractProducts, extractSectors, extractMetrics).
// Pure, deterministic; no network calls.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  productsFrom as ontologyProductsFrom,
  sectorsFrom as ontologySectorsFrom,
  metricsBySector as ontologyMetricsBySector,
} from "./ontology";

export type MetricMap = Record<string, string[]>;

/** Extract normalized product tags from site text (+ optional meta keywords). */
export function extractProducts(text: string, keywords?: string[]): string[] {
  const t = String(text || "");
  const kw = Array.isArray(keywords) ? keywords : [];
  return ontologyProductsFrom(t, kw);
}

/** Extract normalized sector/audience hints from site text (+ optional meta keywords). */
export function extractSectors(text: string, keywords?: string[]): string[] {
  const t = String(text || "");
  const kw = Array.isArray(keywords) ? keywords : [];
  return ontologySectorsFrom(t, kw);
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
  return ontologyMetricsBySector(t, sectors, products);
}

/** Alias kept for callers still importing { metricsBySector } from this module. */
export const metricsBySector = extractMetrics;

/** Aliases for legacy callers importing { productsFrom, sectorsFrom }. */
export const productsFrom = extractProducts;
export const sectorsFrom = extractSectors;

/** Optional aggregator some code uses; currently same as extractMetrics. */
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
  metricsBySector,
  productsFrom,
  sectorsFrom,
  aggregateBottomUp,
};