/**
 * Async fetch orchestration for the Query Loop (spec §10). Isolated from React so it is
 * unit-testable. Enforces the per-render query budget, skips when unconfigured, and
 * converts provider failures into an error state instead of throwing.
 */
import type { DataProvider } from "../dataProvider";

import type { QueryLoopConfig, QueryResult } from "./types";

export interface QueryBudget {
  n: number;
}

export async function runQuery(
  dataProvider: DataProvider | undefined,
  config: QueryLoopConfig,
  budget: QueryBudget
): Promise<QueryResult> {
  if (!dataProvider || !config.collection) return { items: [], skipped: true };
  if (budget.n <= 0) return { items: [], skipped: true };
  budget.n -= 1;
  try {
    const { items } = await dataProvider.find({
      collection: config.collection,
      where: config.where,
      sort: config.sort,
      limit: typeof config.limit === "number" ? config.limit : undefined,
      populate: config.populate,
    });
    return { items: Array.isArray(items) ? items : [] };
  } catch (err) {
    return {
      items: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
