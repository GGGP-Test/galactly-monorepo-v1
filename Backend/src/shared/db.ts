// Backend/src/db.ts
/**
 * Minimal DB shim to satisfy imports from index.ts and routes/leads.ts
 * without requiring the 'pg' package (which isn't installed in the
 * container). This keeps the service building and running.
 *
 * Next step (when you're ready): swap this shim for a real Postgres
 * client implementation in this SAME file and keep the path stable.
 */

export type QueryResult<T = any> = {
  rows: T[];
  rowCount: number;
};

const dbUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";

/** Report whether a DB URL is configured (useful for health/feature flags). */
export function hasDb(): boolean {
  return Boolean(dbUrl);
}

/** No-op here; exists so callers can safely await ensureSchema(). */
export async function ensureSchema(): Promise<void> {
  // Intentionally empty in the shim. Real impl will CREATE TABLE IF NOT EXISTS...
}

/**
 * Very small placeholder query function.
 * Returns an empty result so callers can handle "no rows" gracefully.
 * This avoids bringing in 'pg' or other drivers for now.
 */
export async function q<T = any>(
  _sql: TemplateStringsArray | string,
  _values?: any[]
): Promise<QueryResult<T>> {
  return { rows: [], rowCount: 0 };
}