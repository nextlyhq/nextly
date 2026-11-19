"use client";

/**
 * A workflow step said to assistive technology as well as in a toast: "Approve: done." once it
 * is taken, and why where it is refused. Said through the review's own polite status region
 * (`lib/announce`), so a screen reader hears it whichever place the step was taken from: the
 * editor's header and the side panel's Review section both take steps through this.
 *
 * @module components/features/entries/review/step-announcement
 */

import { announcerAt } from "@admin/lib/announce";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import type { DocumentActionOutcome } from "../EntryForm/useDocumentActionBindings";

import { useStepTaker, type StepTaker } from "./useStepTaker";

/** The id of the one region workflow steps are said through; the browser specs find it by it. */
const REVIEW_ANNOUNCER_ID = "nextly-review-announcer";

/**
 * Says `message` through the review's region: for a step taken somewhere other than through
 * {@link useAnnouncedStepTaker}, such as approving every language at once, or a fix taken from
 * "Ready to publish?".
 */
export const announceReview = announcerAt(REVIEW_ANNOUNCER_ID);

/**
 * What a step's outcome is said as, or null where nothing is to be said: a step taken, in the
 * words its toast uses; a refusal no one has been told of, with its reason; a question dismissed,
 * nothing. A refusal already told (`reported`) is drawn where the step was taken, as an alert
 * assistive technology reads at once, so saying it here too would say it twice.
 */
export function stepOutcomeWords(
  step: Pick<ReviewStep, "label">,
  outcome: DocumentActionOutcome
): string | null {
  if (outcome.ok) return `${step.label}: done.`;
  if (outcome.reason === "cancelled" || outcome.reported === true) return null;
  return outcome.message;
}

/**
 * {@link useStepTaker}, with each step's outcome said to assistive technology once it is known.
 * Everything else it hands back is the taker's own.
 */
export function useAnnouncedStepTaker(
  document: ReleaseDocumentRef | undefined
): StepTaker {
  const taker = useStepTaker(document);
  return {
    ...taker,
    take: async (step: ReviewStep, parts: readonly PartReview[]) => {
      const outcome = await taker.take(step, parts);
      const words = stepOutcomeWords(step, outcome);
      if (words !== null) announceReview(words);
      return outcome;
    },
  };
}
