"use client";

/**
 * One part's changes under review, as the review card and the Approve all
 * languages dialog both read them: which two versions are compared, and what
 * the comparison is said to be against. One reading, so a part's changes are
 * the same wherever a reviewer meets them.
 *
 * @module components/features/entries/review/part-changes
 */

import { useVersions } from "@admin/hooks/queries/useVersions";
import { useLocalization } from "@admin/hooks/useLocalization";
import type { VersionScope } from "@admin/services/versionApi";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview } from "@admin/types/workflows";

import { reviewPair, type ReviewPair } from "./review-pair";

/** A part's comparison, while its versions are read, and whether reading them failed. */
export interface PartPair {
  pair: ReviewPair | undefined;
  isError: boolean;
}

/**
 * The pair a part is reviewed by, read from the part's own versions (a
 * language's, or, for the shared part, the document's). Nothing is read
 * while `enabled` is false.
 */
export function usePartPair(
  scope: VersionScope,
  part: PartReview | undefined,
  enabled: boolean
): PartPair {
  const versions = useVersions({
    scope,
    enabled: enabled && part !== undefined,
    ...(part?.part == null ? {} : { locale: part.part }),
  });
  const listed = versions.data?.pages[0]?.items;
  return {
    pair:
      listed === undefined || part === undefined
        ? undefined
        : reviewPair(listed, part.approval?.versionNo ?? null),
    isError: versions.isError,
  };
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
      return "Nothing was published or approved before: all of it is new.";
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
