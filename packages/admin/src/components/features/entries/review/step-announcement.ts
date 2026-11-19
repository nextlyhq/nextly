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

/** The id of the one region workflow steps are said through. */
export const REVIEW_ANNOUNCER_ID = "nextly-review-announcer";

const announce = announcerAt(REVIEW_ANNOUNCER_ID);

/**
 * What a step's outcome is said as, or null where nothing is to be said: a step taken, in the
 * words its toast uses; a refusal, with its reason; a question dismissed, nothing.
 */
export function stepOutcomeWords(
  step: Pick<ReviewStep, "label">,
  outcome: DocumentActionOutcome
): string | null {
  if (outcome.ok) return `${step.label}: done.`;
  if (outcome.reason === "cancelled") return null;
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
      if (words !== null) announce(words);
      return outcome;
    },
  };
}
