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
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";

import {
  reviewKeys,
  useReviewState,
} from "@admin/hooks/queries/useReviewState";
import { versionKeys } from "@admin/hooks/queries/useVersions";
import { useLocalization } from "@admin/hooks/useLocalization";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import type { ReviewActionState } from "../EntryForm/document-actions";
import type {
  DocumentActionOutcome,
  DocumentReviewBinding,
} from "../EntryForm/useDocumentActionBindings";

import { versionScopeOf } from "./part-changes";
import {
  partsOnScreen,
  takeableOnEvery,
  waitingForWords,
} from "./review-words";
import { approves, useSharedApprovalHold } from "./shared-hold";
import { useAnnouncedStepTaker } from "./step-announcement";
import { STEP_NOT_OFFERED } from "./useStepTaker";

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
  /**
   * Why the host holds every step at this moment, where something does: a
   * past version on screen, or a save or a recovery on its way. The header
   * holds its steps for these through the action model; the review's other
   * actions read it from `hold`.
   */
  held?: string | undefined;
  /**
   * Whether a workflow may hold the document's publishing, as the schema read
   * says before the review state is: false where none is attached, so
   * Publish is not held while the state is read. Absent where the page cannot
   * tell, and Publish waits for the review state.
   */
  workflowExpected?: boolean;
}

export interface EditorReview {
  /** What the header's actions read; absent where no workflow holds the part. */
  binding: DocumentReviewBinding | undefined;
  /** The part on screen, while it stands in a stage of an attached workflow. */
  part: PartReview | undefined;
  /**
   * The parts the header's steps move together: the part on screen first,
   * with the shared part where it waits in the same stage. Empty where none
   * waits.
   */
  onScreen: readonly PartReview[];
  /** Every part of the document the caller may read, whatever its stage. */
  parts: readonly PartReview[];
  /** Why the last step taken from the header was refused; null otherwise. */
  refusal: string | null;
  /** Forgets that refusal. */
  clearRefusal: () => void;
  /**
   * Why no step can be taken from outside the header at this moment (as the
   * header's own steps are held): the host's hold, else unsaved edits or an
   * unsaved document. Undefined where nothing holds them.
   */
  hold: string | undefined;
  /**
   * Why no step can be taken on any part at this moment, whichever surface
   * offers it: the host's hold, else unsaved edits, which a step would not
   * carry. The side panel's steps wait for it as the header's do. Undefined
   * where nothing holds them.
   */
  stepsHold: string | undefined;
  /** The dialog a step needing a comment asks with. */
  dialog: ReactNode;
}

export function useEditorReview({
  document,
  locale,
  isDirty,
  storedStamp,
  held,
  workflowExpected,
}: EditorReviewInput): EditorReview {
  const query = useReviewState(document);
  const { defaultLocale } = useLocalization();
  // Each step said to assistive technology as well as in a toast.
  const taker = useAnnouncedStepTaker(document);
  const queryClient = useQueryClient();

  // A store moves the review (an edit to approved content returns it to
  // review), so a new stamp asks again; the first render asks anyway. It
  // records a version too, so the document's versions and comparisons are
  // read again with it: the changes shown stay those of the version the
  // review state now says was seen.
  const stamp = useRef(storedStamp);
  useEffect(() => {
    if (stamp.current === storedStamp || document === undefined) return;
    stamp.current = storedStamp;
    const scope = versionScopeOf(document);
    for (const queryKey of [
      reviewKeys.document(document),
      versionKeys.list(scope),
      versionKeys.documentDiffs(scope),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [storedStamp, document, queryClient]);

  // The parts one step moves together, the first of them the one the header
  // speaks for.
  const onScreen = partsOnScreen(query.data, locale ?? defaultLocale);
  const part = onScreen[0];
  const parts =
    document !== undefined && query.data?.attached === true
      ? query.data.review.parts
      : [];
  // Where the shared fields' version under review is hidden from this person,
  // their approval of the shared fields is held: here (the shared part on
  // screen) and in approve-all (the shared part among those waiting for it).
  const sharedHeld = useSharedApprovalHold(document, parts);
  const sharedOnScreen = onScreen.some(
    candidate =>
      candidate.part === null &&
      candidate.steps.some(step => approves(step) && step.mayTake)
  );
  const stepsHold = held ?? (isDirty ? SAVE_FIRST : undefined);
  const stepReason =
    stepHold(isDirty, taker.pending, onScreen).stepReason ??
    (sharedOnScreen ? sharedHeld : undefined);
  const hold = stepsHold ?? stepReason ?? sharedHeld;

  // Until the review state is known, a workflow may be holding the part: the
  // header holds Publish, saying why, rather than offering it as free. Not
  // where the page knows no workflow is attached.
  const unknown =
    document !== undefined &&
    query.data === undefined &&
    workflowExpected !== false
      ? reviewUnknown(query.isError)
      : undefined;

  if (document === undefined || part === undefined) {
    return {
      binding: unknown,
      part: undefined,
      onScreen: [],
      parts,
      refusal: null,
      clearRefusal: taker.clearRefusal,
      hold,
      stepsHold,
      dialog: null,
    };
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
    ...(stepReason === undefined ? {} : { stepReason }),
  };

  return {
    binding: { state, takeStep },
    part,
    onScreen,
    parts,
    refusal: taker.refusal,
    clearRefusal: taker.clearRefusal,
    hold,
    stepsHold,
    dialog: taker.dialog,
  };
}

/**
 * What the header's actions read while the review state is not known: no
 * step, and Publish held with why, as a stage that does not allow publishing
 * holds it. No step is offered, so none is taken.
 */
function reviewUnknown(failed: boolean): DocumentReviewBinding {
  return {
    state: {
      stageLabel: "",
      publishable: false,
      steps: [],
      waitingFor: null,
      publishReason: failed
        ? "The review state couldn't be read. Reload the page to try again."
        : "Checking the review…",
    },
    takeStep: () => Promise.resolve(STEP_NOT_OFFERED),
  };
}

/** Why a step waits while the page holds edits a step would not carry. */
const SAVE_FIRST = "Save your changes first.";

/**
 * Why no step can be taken at this moment, where something holds them: a step
 * already on its way holds the others, so a second click sends no second step
 * with the revision the first is about to move.
 */
function stepHold(
  isDirty: boolean,
  stepPending: boolean,
  parts: readonly PartReview[]
): { stepReason?: string } {
  if (isDirty) return { stepReason: SAVE_FIRST };
  if (stepPending) return { stepReason: "Taking the step…" };
  if (parts.some(part => part.version === null)) {
    return { stepReason: "Save the document first." };
  }
  return {};
}
