/**
 * When the shared fields' approval is held for this person.
 *
 * The shared fields' version under review is the document's newest version in
 * any language (`reviewedVersionNo`), while a person's history leaves out the
 * languages they may not read. Where the newest version they can see is not
 * that one, it was saved in a language hidden from them: approving the shared
 * fields would approve a version they never saw, so it is held. A person who
 * can see the version under review is never held.
 *
 * @module components/features/entries/review/shared-hold
 */

import { useVersions } from "@admin/hooks/queries/useVersions";
import type { VersionScope } from "@admin/services/versionApi";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview } from "@admin/types/workflows";

import { versionScopeOf } from "./part-changes";

/** Why the shared fields' approval is held: their newest version is hidden from this person. */
export const SHARED_APPROVAL_HELD =
  "The shared fields were last saved in a language you can't read, so you can't see what you would approve. Someone who can read it approves the shared fields.";

/** Why it is held for a moment: the version this person can see is still being read. */
const SHARED_APPROVAL_READING = "Reading the version under review…";

/** A scope no query is asked for, while there is no document to read. */
const NO_SCOPE: VersionScope = { kind: "collection", slug: "", entryId: "" };

/** Whether a step approves, so the hold applies to it. */
export function approves(step: { kind: string }): boolean {
  return step.kind === "approve";
}

/**
 * Why this person's approval of the shared fields is held, or undefined where
 * it is not: where they may approve the shared part, and the newest version
 * their history shows is not the version under review.
 */
export function useSharedApprovalHold(
  document: ReleaseDocumentRef | undefined,
  parts: readonly PartReview[]
): string | undefined {
  const shared = parts.find(part => part.part === null);
  const judged =
    document !== undefined &&
    shared !== undefined &&
    shared.reviewedVersionNo !== null &&
    shared.steps.some(step => approves(step) && step.mayTake);
  // Every language this person may read, newest first: the same list the
  // shared fields' comparison reads.
  const versions = useVersions({
    scope: document === undefined ? NO_SCOPE : versionScopeOf(document),
    enabled: judged,
  });
  if (!judged) return undefined;
  if (versions.isError) return SHARED_APPROVAL_HELD;
  const listed = versions.data?.pages[0]?.items;
  if (listed === undefined) return SHARED_APPROVAL_READING;
  const newest = listed.find(
    version => version.versionNo !== null && !version.isAutosave
  );
  return newest?.versionNo === shared.reviewedVersionNo
    ? undefined
    : SHARED_APPROVAL_HELD;
}
