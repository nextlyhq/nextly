// Why: centralize the auto-filter rule so every find/findOne/count path uses
// the same safety logic. Public/untrusted callers default to 'published';
// trusted callers (overrideAccess: true) see everything; explicit 'all' /
// 'draft' / 'published' overrides defaults regardless of trust.
//
// Pure logic only — no DB or Drizzle coupling. Each query service maps the
// returned filter value to its own SQL condition.

/** Caller-facing status filter override. */
export type StatusOption = "published" | "draft" | "all";

/** Subset that maps directly to a column equality predicate. */
export type StatusFilterValue = "published" | "draft";

export type ResolveStatusFilterArgs = {
  /** True when the target collection/single has Draft/Published enabled. */
  collectionHasStatus: boolean;
  /**
   * True when the caller has bypassed access checks (admin UI, trusted
   * server-side calls). The same flag that already gates per-row access
   * filters in the query services. Reusing it keeps the trust model
   * consistent — see collection-query-service.ts.
   */
  overrideAccess: boolean;
  /** Explicit caller intent ('all' | 'draft' | 'published'). */
  explicit?: StatusOption;
};

/**
 * Decide whether to apply a status filter and which value to filter by.
 * Returns null when no filter should be applied (collection has no status
 * column, or caller is trusted with no explicit choice, or explicit was 'all').
 */
export function resolveStatusFilter(
  args: ResolveStatusFilterArgs
): { value: StatusFilterValue } | null {
  if (!args.collectionHasStatus) return null;
  if (args.explicit === "all") return null;
  if (args.explicit === "draft") return { value: "draft" };
  if (args.explicit === "published") return { value: "published" };
  if (args.overrideAccess) return null;
  return { value: "published" };
}
