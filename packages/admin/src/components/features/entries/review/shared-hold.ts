/**
 * When the shared fields' approval is held for this person.
 *
 * The shared fields' version under review is the document's newest version in
 * any language, and a person's review state and history leave out the
 * languages they may not read. Where they cannot read every language, that
 * newest version may be one they cannot see, while the step would still
 * approve it: so their approval of the shared fields is held. It can hold a
 * person who could in fact see the newest version; it never lets one approve
 * a version they could not.
 *
 * @module components/features/entries/review/shared-hold
 */

import type { PartReview } from "@admin/types/workflows";

/** Why the shared fields' approval is held. */
export const SHARED_APPROVAL_HELD =
  "You can't read every language, and the shared fields may have been saved in one you can't see. Someone who can read every language approves the shared fields.";

/**
 * Whether `parts` (the document's parts this person may read) leave out a
 * language of the `languageCount` the site has. An untranslated document,
 * with the shared part alone, leaves none out.
 */
export function hidesALanguage(
  parts: readonly PartReview[],
  languageCount: number
): boolean {
  const languages = parts.filter(part => part.part !== null).length;
  return languages > 0 && languages < languageCount;
}

/** Whether a step approves, so the hold applies to it. */
export function approves(step: { kind: string }): boolean {
  return step.kind === "approve";
}
