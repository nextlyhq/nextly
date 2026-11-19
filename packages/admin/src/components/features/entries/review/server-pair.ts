/**
 * How a part's pair is found from the server's baselines, as plain decisions
 * the review hooks only wire to queries: what is asked (the version under
 * review, in which language or part), which baseline is asked and in what
 * order (since approved, then published once the server says there is no
 * approval), and what the answers mean (a pair, a refusal shown as the
 * version whole, or a failure).
 *
 * @module components/features/entries/review/server-pair
 */

import { validationIssues } from "@admin/lib/api/parseApiError";
import type { VersionMeta } from "@admin/services/versionApi";
import type { PartReview } from "@admin/types/workflows";

import { reviewPlan, type ReviewPair, type ReviewPlan } from "./review-pair";

/** The server baselines a part is compared with, in the order they are asked. */
export const SINCE_APPROVED = "since-approved";
export const PUBLISHED = "published";

/** The part the server compares the shared fields as. */
export const SHARED_PART = "shared";

/** Where the server pairs: a language, or the shared part across languages. */
export interface PairWhere {
  locale?: string | undefined;
  part?: typeof SHARED_PART;
}

/** A baseline query's state, as the hooks hand it over. */
export interface BaselineQueryState {
  data?: { from: number; to: number } | undefined;
  isError: boolean;
  error?: unknown;
}

/**
 * What one baseline query answered: its pair, the server's reason where it
 * said there is nothing to compare with, or a failure of any other kind.
 */
export interface BaselineAnswer {
  pair: { from: number; to: number } | undefined;
  refusal: string | undefined;
  failed: boolean;
}

/** A part's comparison, and whether reading it failed. */
export interface ServerPair {
  pair: ReviewPair | undefined;
  isError: boolean;
}

/** Where a part's pair is found: the shared part across languages, or its language. */
export function pairWhereOf(part: PartReview | undefined): PairWhere {
  return part?.part === null
    ? { part: SHARED_PART }
    : { locale: part?.part ?? undefined };
}

/**
 * A language's plan from the first page of its versions; undefined while
 * they are read, for no part, and for the shared part, which reads no list.
 */
export function languagePlanOf(
  part: PartReview | undefined,
  listed: readonly VersionMeta[] | undefined
): ReviewPlan | undefined {
  if (listed === undefined || part === undefined || part.part === null) {
    return undefined;
  }
  return reviewPlan(listed, part.part, part.approval?.versionNo ?? null);
}

/**
 * What every baseline query of a plan names: the version under review where
 * the plan names one, and the language or part to pair in.
 */
export function baselineTargetOf(
  plan: ReviewPlan | undefined,
  where: PairWhere
): { to?: number; locale?: string; part?: typeof SHARED_PART } {
  const to = plan?.kind === "server" ? plan.to : undefined;
  return {
    ...(to === undefined ? {} : { to }),
    ...(where.locale === undefined ? {} : { locale: where.locale }),
    ...(where.part === undefined ? {} : { part: where.part }),
  };
}

/** The first baseline asked: since approved, wherever the plan asks the server. */
export function approvedBaselineOf(
  plan: ReviewPlan | undefined
): string | null {
  return plan?.kind === "server" ? SINCE_APPROVED : null;
}

/**
 * The second baseline asked: published, only once the server has said the
 * part has no approval to compare with.
 */
export function publishedBaselineOf(
  plan: ReviewPlan | undefined,
  approved: BaselineAnswer
): string | null {
  return plan?.kind === "server" && approved.refusal !== undefined
    ? PUBLISHED
    : null;
}

/**
 * What a baseline query answered. A refusal the server names on `baseline`
 * is an answer (there is nothing to compare with); any other error fails.
 */
export function baselineAnswerOf(query: BaselineQueryState): BaselineAnswer {
  const refusal = query.isError
    ? validationIssues(query.error).find(issue => issue.path === "baseline")
        ?.message
    : undefined;
  // The pair alone: the answer's fields are drawn by the pair's own comparison.
  const pair =
    query.data === undefined
      ? undefined
      : { from: query.data.from, to: query.data.to };
  return {
    pair,
    refusal,
    failed: query.isError && refusal === undefined,
  };
}

/**
 * The pair a plan comes to with its baselines' answers: since approved where
 * the server had an approval, else since published, else, refused both
 * times, the version under review whole with the server's reason. A plan
 * that asks nothing of the server is its own answer.
 */
export function serverPairOf(
  plan: ReviewPlan | undefined,
  approved: BaselineAnswer,
  published: BaselineAnswer,
  where: PairWhere
): ServerPair {
  return {
    pair: pairOf(plan, approved, published, where.part),
    isError: approved.failed || published.failed,
  };
}

function pairOf(
  plan: ReviewPlan | undefined,
  approved: BaselineAnswer,
  published: BaselineAnswer,
  part: typeof SHARED_PART | undefined
): ReviewPair | undefined {
  if (plan === undefined) return undefined;
  if (plan.kind !== "server") return plan;
  // The shared part's pair compares the shared fields alone.
  const comparedAs = part === undefined ? {} : { part };
  if (approved.pair !== undefined) {
    return {
      kind: "pair",
      from: approved.pair.from,
      to: approved.pair.to,
      since: "approved",
      seededBy: SINCE_APPROVED,
      ...comparedAs,
    };
  }
  if (published.pair !== undefined) {
    return {
      kind: "pair",
      from: published.pair.from,
      to: published.pair.to,
      since: "published",
      seededBy: PUBLISHED,
      ...comparedAs,
    };
  }
  // Refused twice: nothing approved or published in the part to compare with.
  if (published.refusal === undefined) return undefined;
  return plan.to === undefined
    ? { kind: "none" }
    : { kind: "first", to: plan.to, reason: published.refusal };
}
