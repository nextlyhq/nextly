"use client";

/**
 * The workflow's part of a translation page: where the language stands, and the
 * step this person may take on it next.
 *
 * The editor's own review, read for the language and kept to it. The editor
 * moves the shared fields together with a language waiting in the same stage,
 * because an edit there moves both. Here only the language is on screen, so
 * only the language is moved: nobody approves shared fields from a page that
 * does not show them. Where the shared fields alone wait, the page offers no
 * step, and they are reviewed in the editor.
 *
 * @module components/features/translations/workflow/useTranslationReview
 */

import type { ReactNode } from "react";

import type { ReviewActionState } from "@admin/components/features/entries/EntryForm/document-actions";
import type { DocumentReviewBinding } from "@admin/components/features/entries/EntryForm/useDocumentActionBindings";
import {
  useEditorReview,
  type EditorReviewInput,
} from "@admin/components/features/entries/review/useEditorReview";
import {
  STEP_NOT_OFFERED,
  useStepTaker,
} from "@admin/components/features/entries/review/useStepTaker";
import { useReviewState } from "@admin/hooks/queries/useReviewState";
import type { PartReview } from "@admin/types/workflows";

export interface TranslationReviewInput
  extends Omit<EditorReviewInput, "locale"> {
  /** The code of the language the page writes. */
  language: string;
}

export interface TranslationReview {
  /**
   * What the header's actions read: the language's stage and steps, or that
   * they are not known yet. Absent where no workflow holds the language.
   */
  binding: DocumentReviewBinding | undefined;
  /**
   * Whether a workflow holds the document's publishing, or may: one is attached,
   * or it isn't known yet. A language with nothing waiting stands in no stage,
   * and a save still puts it in one.
   */
  attached: boolean;
  /** The language's part, while it stands in a stage. */
  part: PartReview | undefined;
  /** Why the last step was refused, in words; null otherwise. */
  refusal: string | null;
  /** Forgets that refusal. */
  clearRefusal: () => void;
  /** The dialog a step needing a comment asks with, to mount once. */
  dialog: ReactNode;
}

export function useTranslationReview({
  language,
  ...input
}: TranslationReviewInput): TranslationReview {
  const review = useEditorReview({ ...input, locale: language });
  // A taker of this page's own, so a step is sent for the language alone.
  const taker = useStepTaker(input.document);
  const { refusal, clearRefusal, dialog } = taker;
  const { data: answer } = useReviewState(input.document);
  const attached = answer?.attached === true || review.binding !== undefined;
  const said = { attached, refusal, clearRefusal, dialog };

  // No part waits, or none is known yet: the editor's answer says which.
  if (review.part === undefined) {
    return { binding: review.binding, part: undefined, ...said };
  }
  const part = review.part;
  // The part on screen is the language's own whenever the language waits.
  if (part.part !== language || review.binding === undefined) {
    return { binding: undefined, part: undefined, ...said };
  }

  const stepReason =
    review.stepsHold ?? stepHold(taker.pending, part.version === null);
  const { stageLabel, publishable, waitingFor, steps } = review.binding.state;
  const state: ReviewActionState = {
    stageLabel,
    publishable,
    waitingFor,
    // Whether the person may take each on the language, whatever they may do
    // to the shared fields.
    steps: steps.map(step => ({
      ...step,
      held: part.steps.some(each => each.name === step.name && each.mayTake),
    })),
    ...(stepReason === undefined ? {} : { stepReason }),
  };

  return {
    binding: {
      state,
      takeStep: name => {
        const step = part.steps.find(
          each => each.name === name && each.mayTake
        );
        return step === undefined
          ? Promise.resolve(STEP_NOT_OFFERED)
          : taker.take(step, [part]);
      },
    },
    part,
    ...said,
  };
}

/**
 * Why no step can be taken on the language at this moment, beyond what holds
 * the page: one already on its way, or nothing stored to take it on.
 */
function stepHold(stepPending: boolean, unstored: boolean): string | undefined {
  if (stepPending) return "Taking the step…";
  return unstored ? "Save the translation first." : undefined;
}
