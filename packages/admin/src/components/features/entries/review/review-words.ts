/**
 * How the editor reads a document's review state: which parts are on screen,
 * and who a part waits for, in words. One reading, so the header, the status
 * line and the side panel say the same thing.
 *
 * @module components/features/entries/review/review-words
 */

import type {
  PartReview,
  ReviewStateAnswer,
  ReviewWaitingFor,
} from "@admin/types/workflows";

/**
 * The parts the editor on screen acts for: the language being edited, and
 * the shared part where it stands in the same stage, since the same edit
 * moves both. A document that is not translated has only the shared part.
 * Empty where no workflow is attached.
 */
export function partsOnScreen(
  answer: ReviewStateAnswer | undefined,
  language: string | undefined
): PartReview[] {
  if (answer === undefined || !answer.attached) return [];
  const { parts } = answer.review;
  const shared = parts.find(part => part.part === null);
  const own =
    language === undefined
      ? undefined
      : parts.find(part => part.part === language);
  if (own === undefined) return shared === undefined ? [] : [shared];
  return shared !== undefined && shared.stage === own.stage
    ? [own, shared]
    : [own];
}

/** Who a part waits for, as words; null where it waits for no one. */
export function waitingForWords(
  waitingFor: ReviewWaitingFor | null
): string | null {
  if (waitingFor === null) return null;
  if (waitingFor.kind === "user") return waitingFor.name ?? "the assignee";
  const names = waitingFor.roles.map(role => role.name ?? "a removed role");
  return names.length === 0 ? null : names.join(" or ");
}

/**
 * What changes whenever the document is stored, for the review state to be
 * asked again: a save, a publish or a discard each moves it.
 */
export function storedStampOf(
  entry:
    | {
        updatedAt?: unknown;
        updated_at?: unknown;
        status?: unknown;
        _isWorkingDraft?: unknown;
      }
    | null
    | undefined
): string {
  return JSON.stringify([
    entry?.updatedAt ?? entry?.updated_at ?? null,
    entry?.status ?? null,
    entry?._isWorkingDraft ?? null,
  ]);
}
