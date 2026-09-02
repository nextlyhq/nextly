// Why: centralize the auto-filter rule so every find/findOne/count path uses
// the same safety logic. Public/untrusted callers default to 'published';
// trusted callers (overrideAccess: true) see everything; explicit 'all' /
// 'draft' / 'published' overrides defaults regardless of trust.
//
// Pure logic only — no DB or Drizzle coupling. Each query service maps the
// returned filter value to its own SQL condition.

import {
  DEFAULT_WORKFLOW,
  nonPublicStateNames,
  publicStateNames,
  type ContentWorkflow,
} from "./content-states";

/** Caller-facing status filter override. */
export type StatusOption = "published" | "draft" | "all";

/**
 * The state name a lifecycle-bounded read filters by.
 *
 * NOT a closed union, deliberately. A workflow names its own states, so the set
 * of values this can hold is open, and a two-value type would only be kept true
 * by casting the third value into it — which is how a consumer comparing the
 * literal `"published"` would go on compiling while silently taking the wrong
 * branch.
 */
export type StatusFilterValue = string;

/**
 * The lifecycle a read is bounded to.
 *
 * A SET, because a workflow may call several states public — `published` and a
 * `featured` that is also live — and an equality would drop every row in the
 * others from public reads without erroring.
 *
 * `isPublicRead` is carried rather than re-derived. Consumers need it to decide
 * whether a due release can widen the read, and the resolver is the only place
 * that knows WHY the set was chosen: a caller naming `draft` and a workflow
 * whose only non-public state happens to be absent produce different intents
 * from the same names. Re-deriving it downstream is the second implementation
 * this module exists to prevent.
 */
export interface StatusFilter {
  readonly values: readonly StatusFilterValue[];
  /** True when this read is bounded to the workflow's public states. */
  readonly isPublicRead: boolean;
}

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
  /**
   * The workflow whose states this collection moves through.
   *
   * Defaults to the only workflow that existed before workflows were
   * configurable, so a collection that names none behaves exactly as it did.
   */
  workflow?: ContentWorkflow;
};

/**
 * Decide whether to bound this read to a lifecycle, and to which states.
 *
 * Returns `null` when no filter applies: the collection has no status column,
 * the caller asked for everything, or a trusted caller said nothing.
 *
 * The two caller-facing words keep their meanings and gain the workflow's
 * vocabulary. `published` is every state the workflow calls public and `draft`
 * is every state it does not — so a team that adds `in_review` finds its
 * drafts view already showing that work, without the query API learning a word.
 */
export function resolveStatusFilter(
  args: ResolveStatusFilterArgs
): StatusFilter | null {
  const workflow = args.workflow ?? DEFAULT_WORKFLOW;
  if (!args.collectionHasStatus) return null;
  if (args.explicit === "all") return null;
  if (args.explicit === "draft") {
    return { values: nonPublicStateNames(workflow), isPublicRead: false };
  }
  if (args.explicit === "published") {
    return { values: publicStateNames(workflow), isPublicRead: true };
  }
  if (args.overrideAccess) return null;
  /*
   * ASKED of the workflow rather than written as a literal, which is what lets
   * a team add a state without teaching every reader a new word.
   *
   * This is the branch that decides what an UNTRUSTED caller sees, so its
   * failure mode is the dangerous one: a mistake here does not hide content,
   * it publishes it. The workflow is the only input, and a state it does not
   * declare as public is absent from this set by construction.
   */
  return { values: publicStateNames(workflow), isPublicRead: true };
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
