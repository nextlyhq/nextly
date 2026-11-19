"use client";

/**
 * One part's changes under review, as the review card and the Approve all
 * languages dialog both read them: which two versions are compared, and what
 * the comparison is said to be against. One reading, so a part's changes are
 * the same wherever a reviewer meets them.
 *
 * @module components/features/entries/review/part-changes
 */

import { useBaselineDiff, useVersions } from "@admin/hooks/queries/useVersions";
import { useLocalization } from "@admin/hooks/useLocalization";
import { validationIssues } from "@admin/lib/api/parseApiError";
import type { VersionScope } from "@admin/services/versionApi";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview } from "@admin/types/workflows";

import { reviewPlan, type ReviewPair, type ReviewPlan } from "./review-pair";

/** A part's comparison, while its versions are read, and whether reading them failed. */
export interface PartPair {
  pair: ReviewPair | undefined;
  isError: boolean;
}

/**
 * Why the server has nothing to compare a baseline with, in its words: a
 * refusal it names on `baseline`. Undefined for any other failure.
 */
function baselineRefusalOf(error: unknown): string | undefined {
  return validationIssues(error).find(issue => issue.path === "baseline")
    ?.message;
}

/** The server baselines a part is compared with, in the order they are asked. */
const SINCE_APPROVED = "since-approved";
const PUBLISHED = "published";

/**
 * The pair a part is reviewed by. The version under review is the part's
 * newest (a language's own, or for the shared part the document's newest in
 * any language, as `reviewPlan` reads it). It is compared with what the
 * server's `since-approved` baseline answers, which keeps the part's last
 * approval even where an edit withdrew it since; where the server says the
 * part has none, with its `published` baseline. Nothing is read while
 * `enabled` is false.
 */
export function usePartPair(
  scope: VersionScope,
  part: PartReview | undefined,
  enabled: boolean
): PartPair {
  const locale = part?.part ?? undefined;
  const versions = useVersions({
    scope,
    enabled: enabled && part !== undefined,
    ...(locale === undefined ? {} : { locale }),
  });
  const listed = versions.data?.pages[0]?.items;
  const plan =
    listed === undefined || part === undefined
      ? undefined
      : reviewPlan(listed, part.part, part.approval?.versionNo ?? null);
  const server = plan?.kind === "server" ? plan : undefined;
  const target = {
    scope,
    ...(server?.to === undefined ? {} : { to: server.to }),
    ...(locale === undefined ? {} : { locale }),
    enabled,
  };
  const approved = useBaselineDiff({
    ...target,
    baseline: server === undefined ? null : SINCE_APPROVED,
  });
  const noApproval = approved.isError
    ? baselineRefusalOf(approved.error)
    : undefined;
  // Asked only once the server says the part was never approved.
  const published = useBaselineDiff({
    ...target,
    baseline:
      server === undefined || noApproval === undefined ? null : PUBLISHED,
  });
  const nothingPublished = published.isError
    ? baselineRefusalOf(published.error)
    : undefined;
  return {
    pair: pairOf(plan, approved.data, published.data, nothingPublished),
    isError:
      versions.isError ||
      (approved.isError && noApproval === undefined) ||
      (published.isError && nothingPublished === undefined),
  };
}

/** The pair a plan comes to, with the server baselines' answers where it asked them. */
function pairOf(
  plan: ReviewPlan | undefined,
  sinceApproved: { from: number; to: number } | undefined,
  sincePublished: { from: number; to: number } | undefined,
  refusal: string | undefined
): ReviewPair | undefined {
  if (plan === undefined) return undefined;
  if (plan.kind !== "server") return plan;
  if (sinceApproved !== undefined) {
    return {
      kind: "pair",
      from: sinceApproved.from,
      to: sinceApproved.to,
      since: "approved",
      seededBy: SINCE_APPROVED,
    };
  }
  if (sincePublished !== undefined) {
    return {
      kind: "pair",
      from: sincePublished.from,
      to: sincePublished.to,
      since: "published",
      seededBy: PUBLISHED,
    };
  }
  // Refused twice: nothing approved or published in the part to compare with.
  if (refusal === undefined) return undefined;
  return plan.to === undefined
    ? { kind: "none" }
    : { kind: "first", to: plan.to, reason: refusal };
}

/** What a part's comparison is against, or why there is none, in words. */
export function partPairWords({ pair, isError }: PartPair): string {
  if (isError) return "The changes could not be read.";
  if (pair === undefined) return "Reading the changes…";
  switch (pair.kind) {
    case "pair":
      return pair.since === "approved"
        ? "Changes since the approved version."
        : "Changes since the published version.";
    case "first":
      return (
        pair.reason ??
        "Nothing was published or approved before: all of it is new."
      );
    case "unchanged":
      return "Nothing changed since it was approved.";
    case "none":
      return "Nothing has been saved yet.";
  }
}

/** A part's name: its language's label, or "Shared fields" for the shared part. */
export function usePartName(): (part: string | null) => string {
  const { getLocale } = useLocalization();
  return part =>
    part === null ? "Shared fields" : (getLocale(part)?.label ?? part);
}

/** The document the workflow routes name, from the history's own scope. */
export function reviewDocumentOf(scope: VersionScope): ReleaseDocumentRef {
  return scope.kind === "single"
    ? { scopeKind: "single", scopeSlug: scope.slug, entryId: scope.documentId }
    : {
        scopeKind: "collection",
        scopeSlug: scope.slug,
        entryId: scope.entryId,
      };
}
