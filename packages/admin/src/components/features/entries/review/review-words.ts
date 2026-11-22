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
 * The parts the editor's header acts for, moved together by one step: the
 * language being edited while it waits in a stage, with the shared part where
 * it waits in the same stage, since the same edit moves both. Where the
 * language is live with nothing waiting (or the document is not translated),
 * the shared part, while it waits. Empty where no workflow is attached or
 * nothing waits. A shared part waiting in another stage than the language is
 * moved from the side panel's Review section, which offers each part's steps.
 */
export function partsOnScreen(
  answer: ReviewStateAnswer | undefined,
  language: string | undefined
): PartReview[] {
  if (answer === undefined || !answer.attached) return [];
  const { parts } = answer.review;
  const waiting = (part: PartReview | undefined): part is PartReview =>
    part !== undefined && part.stage !== null;
  const shared = parts.find(part => part.part === null);
  const own =
    language === undefined
      ? undefined
      : parts.find(part => part.part === language);
  if (!waiting(own)) return waiting(shared) ? [shared] : [];
  return waiting(shared) && shared.stage === own.stage ? [own, shared] : [own];
}

/**
 * Whether `step` may be taken on every one of `parts`: a step moving them
 * together is offered only where each of them may take it.
 */
export function takeableOnEvery(
  step: { name: string },
  parts: readonly PartReview[]
): boolean {
  return (
    parts.length > 0 &&
    parts.every(part =>
      part.steps.some(each => each.name === step.name && each.mayTake)
    )
  );
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
