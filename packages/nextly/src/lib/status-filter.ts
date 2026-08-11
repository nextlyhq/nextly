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

/**
 * The lifecycle scope an expansion inherits from the read that triggered it.
 *
 * Relationship expansion reads a DIFFERENT collection from the one the caller
 * named, so the scope it runs under is derived rather than stated. Two things
 * can produce a widened scope, and only one of them survives a caller that has
 * bounded itself:
 *
 * - **The caller asked for it.** `status: "all"` is an explicit statement about
 *   what this read should see, and it propagates — unless the caller is
 *   bounded, because that statement is about the row it named, not about a
 *   collection it refused to trust.
 * - **The caller is trusted and said nothing.** `overrideAccess: true` widens
 *   by implication, again only when unbounded.
 *
 * Supplying `trusted` declares one fixed audience; that is the only reason to
 * bound a bypass you already hold. Such a caller must not inherit drafts,
 * because {@link resolveStatusFilter} short-circuits on an explicit `"all"`
 * BEFORE it consults the (now narrowed) override — so an inherited `"all"`
 * would beat the bound rather than be checked against it, and the drafts would
 * come back for every target including the ones the caller refused to trust.
 *
 * Kept here beside the rule it feeds, and pure, because the derivation is made
 * at several call sites and a copy of it drifts silently: the two would then
 * disagree about which reads see unpublished rows.
 */
export function expansionStatusScope(args: {
  /** What the caller asked this read to see, if anything. */
  status?: StatusOption;
  /** Whether the caller bypassed access checks. */
  overrideAccess?: boolean;
  /** Whether the caller bounded that bypass to named collections. */
  bounded: boolean;
}): "all" | undefined {
  // The bound is checked FIRST, ahead of the caller's own `"all"`.
  //
  // A caller that bounds its bypass has declared one fixed audience, and that
  // declaration is about the collections it did NOT name as much as the ones it
  // did. Its `status: "all"` is a statement about the row it asked for; letting
  // that reach a target it refused to trust would publish that target's pending
  // edits — on a public route, into a static artifact.
  //
  // So a bounded caller never widens the lifecycle of an expansion, by any
  // route. Trust decides WHO may read a row; being published decides whether it
  // is ready for anyone, and no amount of the first supplies the second.
  if (args.bounded) return undefined;
  if (args.status === "all") return "all";
  return args.overrideAccess === true ? "all" : undefined;
}
