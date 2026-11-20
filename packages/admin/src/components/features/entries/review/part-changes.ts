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
import type { VersionScope } from "@admin/services/versionApi";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview } from "@admin/types/workflows";

import { sharedReviewPlan, type ReviewPlan } from "./review-pair";
import {
  approvedBaselineOf,
  baselineAnswerOf,
  baselineTargetOf,
  languagePlanOf,
  pairWhereOf,
  publishedBaselineOf,
  serverPairOf,
  type PairWhere,
  type ServerPair,
} from "./server-pair";

/** A part's comparison, while its versions are read, and whether reading them failed. */
export type PartPair = ServerPair;

/**
 * The pair a part is reviewed by. The version under review is a language's
 * own newest (`reviewPlan`, from its versions list), or the shared part's as
 * its review state names it (`sharedReviewPlan`). It is compared with what
 * the server's `since-approved` baseline answers, which keeps the part's last
 * approval even where an edit withdrew it since; where the server says the
 * part has none, with its `published` baseline (`server-pair` decides each
 * step). The shared part is compared as the server's shared part: the shared
 * fields alone, across languages, from the shared part's own approval or the
 * newest publish in any language. Nothing is read while `enabled` is false.
 */
export function usePartPair(
  scope: VersionScope,
  part: PartReview | undefined,
  enabled: boolean
): PartPair {
  const shared = part?.part === null;
  // Asked on every render, idle for the shared part, which reads no list.
  const language = useLanguagePlan(scope, shared ? undefined : part, enabled);
  const plan =
    part !== undefined && shared
      ? sharedReviewPlan(
          part.reviewedVersionNo,
          part.approval?.versionNo ?? null
        )
      : language.plan;
  const server = useServerPair(scope, plan, pairWhereOf(part), enabled);
  return {
    pair: server.pair,
    isError: language.isError || server.isError,
  };
}

/** A language's plan, from the first page of its versions (`languagePlanOf`). */
function useLanguagePlan(
  scope: VersionScope,
  part: PartReview | undefined,
  enabled: boolean
): { plan: ReviewPlan | undefined; isError: boolean } {
  const locale = part?.part ?? undefined;
  const versions = useVersions({
    scope,
    enabled: enabled && part !== undefined,
    ...(locale === undefined ? {} : { locale }),
  });
  return {
    plan: languagePlanOf(part, versions.data?.pages[0]?.items),
    isError: part !== undefined && versions.isError,
  };
}

/**
 * The pair a plan comes to: its two baseline queries, wired as `server-pair`
 * decides what each asks and what its answer means.
 */
function useServerPair(
  scope: VersionScope,
  plan: ReviewPlan | undefined,
  where: PairWhere,
  enabled: boolean
): PartPair {
  const target = { scope, ...baselineTargetOf(plan, where), enabled };
  const approved = baselineAnswerOf(
    useBaselineDiff({ ...target, baseline: approvedBaselineOf(plan) })
  );
  const published = baselineAnswerOf(
    useBaselineDiff({
      ...target,
      baseline: publishedBaselineOf(plan, approved),
    })
  );
  return serverPairOf(plan, approved, published, where);
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

/** The document as the history names it, from the editor's own reference. */
export function versionScopeOf(document: ReleaseDocumentRef): VersionScope {
  return document.scopeKind === "single"
    ? { kind: "single", slug: document.scopeSlug, documentId: document.entryId }
    : {
        kind: "collection",
        slug: document.scopeSlug,
        entryId: document.entryId,
      };
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
