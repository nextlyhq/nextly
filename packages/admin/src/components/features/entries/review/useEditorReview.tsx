"use client";

/**
 * The workflow's part of a document editor: where the part on screen stands,
 * the step this person may take next, and the dialog a step needing a comment
 * asks with.
 *
 * The header draws what this hands it through the one action model
 * (`documentActions`), so a step leads, sits beside the one that leads, or is
 * held, by the same rules as every other action. Where no workflow is
 * attached it hands nothing, and the header is exactly the one a document
 * without a workflow has.
 *
 * Whether the person may take a step, and which step leads, are the review
 * state's own answers (`mayTake`, `primary`), judged on the server by the
 * step's own checks, and a step moving several parts together is offered
 * only where each may take it. A step that needs a comment asks for one
 * first (`commentRequired`); what it checks of the content (the version seen)
 * is asked when it is taken, and a refusal is said where it happens.
 *
 * @module components/features/entries/review/useEditorReview
 * @experimental
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";

import {
  reviewKeys,
  useReviewState,
} from "@admin/hooks/queries/useReviewState";
import { useLocalization } from "@admin/hooks/useLocalization";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import type { ReviewActionState } from "../EntryForm/document-actions";
import type {
  DocumentActionOutcome,
  DocumentReviewBinding,
} from "../EntryForm/useDocumentActionBindings";

import {
  partsOnScreen,
  takeableOnEvery,
  waitingForWords,
} from "./review-words";
import { STEP_NOT_OFFERED, useStepTaker } from "./useStepTaker";

export interface EditorReviewInput {
  /** The document, once it exists; nothing is asked before. */
  document: ReleaseDocumentRef | undefined;
  /** The language being edited; the default language where none is named. */
  locale: string | undefined;
  /** Whether the page holds unsaved edits, which a step would not carry. */
  isDirty: boolean;
  /**
   * Changes whenever the document is stored, so its review state is asked
   * again: a save sends approved content back to review, and a publish
   * starts the next draft.
   */
  storedStamp?: string;
}

export interface EditorReview {
  /** What the header's actions read; absent where no workflow holds the part. */
  binding: DocumentReviewBinding | undefined;
  /** The part on screen, while it stands in a stage of an attached workflow. */
  part: PartReview | undefined;
  /** Every part of the document the caller may read, whatever its stage. */
  parts: readonly PartReview[];
  /** The dialog a step needing a comment asks with. */
  dialog: ReactNode;
}

export function useEditorReview({
  document,
  locale,
  isDirty,
  storedStamp,
}: EditorReviewInput): EditorReview {
  const query = useReviewState(document);
  const { defaultLocale } = useLocalization();
  const taker = useStepTaker(document);
  const queryClient = useQueryClient();

  // A store moves the review (an edit to approved content returns it to
  // review), so a new stamp asks again; the first render asks anyway.
  const stamp = useRef(storedStamp);
  useEffect(() => {
    if (stamp.current === storedStamp || document === undefined) return;
    stamp.current = storedStamp;
    void queryClient.invalidateQueries({
      queryKey: reviewKeys.document(document),
    });
  }, [storedStamp, document, queryClient]);

  // The parts one step moves together, the first of them the one the header
  // speaks for.
  const onScreen = partsOnScreen(query.data, locale ?? defaultLocale);
  const part = onScreen[0];
  const parts =
    document !== undefined && query.data?.attached === true
      ? query.data.review.parts
      : [];

  if (document === undefined || part === undefined) {
    return { binding: undefined, part: undefined, parts, dialog: null };
  }

  // Offered only where every part it moves may take it.
  const holds = (step: ReviewStep): boolean => takeableOnEvery(step, onScreen);

  const takeStep = (name: string): Promise<DocumentActionOutcome> => {
    const step = part.steps.find(candidate => candidate.name === name);
    if (step === undefined || !holds(step)) {
      return Promise.resolve(STEP_NOT_OFFERED);
    }
    return taker.take(step, onScreen);
  };

  const state: ReviewActionState = {
    stageLabel: part.stageLabel ?? part.stage ?? "",
    publishable: part.publishable,
    steps: part.steps.map(step => ({
      name: step.name,
      label: step.label,
      kind: step.kind,
      held: holds(step),
      primary: step.primary,
    })),
    waitingFor: waitingForWords(part.waitingFor),
    ...stepHold(isDirty, onScreen),
  };

  return { binding: { state, takeStep }, part, parts, dialog: taker.dialog };
}

/** Why no step can be taken at this moment, where something holds them. */
function stepHold(
  isDirty: boolean,
  parts: readonly PartReview[]
): { stepReason?: string } {
  if (isDirty) return { stepReason: "Save your changes first." };
  if (parts.some(part => part.version === null)) {
    return { stepReason: "Save the document first." };
  }
  return {};
}
