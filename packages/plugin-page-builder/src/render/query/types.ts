/**
 * Executable Query Loop contracts (spec §10). Kept React-free so the fetch orchestration
 * and config stay unit-testable and import-safe.
 */
export const QUERY_LOOP_TYPE = "core/query-loop";

/** Max collection fetches per page render — bounds nested loops (with MAX_DEPTH). */
export const DEFAULT_QUERY_BUDGET = 20;

export interface QueryLoopConfig {
  collection?: string;
  sort?: string;
  limit?: number;
  /** Reserved: passed through to the provider's `where`. */
  where?: unknown;
  /** Reserved: relation/media population depth. */
  populate?: unknown;
}

export interface QueryResult {
  items: Record<string, unknown>[];
  error?: string;
  /** True when the query was skipped (no provider / no collection / budget spent). */
  skipped?: boolean;
}
