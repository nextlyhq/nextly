"use client";

/**
 * Taking a workflow step on some parts of a document, as the editor's header
 * and the side panel's Review section both do: sent with what the person saw
 * of each part, asking first for the comment a step needs, and said in a toast
 * either way, and a refusal kept in words for the place the step was taken to
 * show. One implementation, so a step taken from either place is sent, asked
 * and reported alike.
 *
 * @module components/features/entries/review/useStepTaker
 * @experimental
 */

import { useState, type ReactNode } from "react";

import { toast } from "@admin/components/ui";
import {
  useReviewState,
  useTakeStep,
} from "@admin/hooks/queries/useReviewState";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type {
  PartReview,
  ReviewStateAnswer,
  ReviewStep,
} from "@admin/types/workflows";

import type { DocumentActionOutcome } from "../EntryForm/useDocumentActionBindings";

import { stepRefusalWords } from "./step-refusal";
import { StepCommentDialog } from "./StepCommentDialog";

/** What a step resolves with where it cannot be sent at all. */
export const STEP_NOT_OFFERED: DocumentActionOutcome = {
  ok: false,
  reason: "refused",
  message: "This step isn't offered for this document.",
};

const CANCELLED: DocumentActionOutcome = {
  ok: false,
  reason: "cancelled",
  message: "Cancelled.",
};

/** A comment being asked for, for which step on which parts, and who waits for the answer. */
interface Asking {
  step: ReviewStep;
  parts: readonly PartReview[];
  resolve: (outcome: DocumentActionOutcome) => void;
}

export interface StepTaker {
  /**
   * Takes `step` on `parts` together, asking first for a comment where the
   * step needs one. Resolves with what it came to; a dismissed question is
   * `cancelled`.
   */
  take: (
    step: ReviewStep,
    parts: readonly PartReview[]
  ) => Promise<DocumentActionOutcome>;
  /** Whether a step is on its way. */
  pending: boolean;
  /**
   * Why the last step was refused, in words, until it is dismissed or the
   * next step is taken; null otherwise. Drawn where the step was taken.
   */
  refusal: string | null;
  /** Forgets the last refusal. */
  clearRefusal: () => void;
  /** The comment dialog, to mount once. */
  dialog: ReactNode;
}

/**
 * `parts` as the review state now reads them: a step refused as stale reads the state again, so
 * a retry from the comment dialog is sent with each part's revision and version as they stand,
 * not those of when it was asked. A part the state no longer names is sent as it was.
 */
function freshParts(
  parts: readonly PartReview[],
  answer: ReviewStateAnswer | undefined
): readonly PartReview[] {
  if (answer?.attached !== true) return parts;
  const now = answer.review.parts;
  return parts.map(
    each => now.find(candidate => candidate.part === each.part) ?? each
  );
}

export function useStepTaker(
  document: ReleaseDocumentRef | undefined
): StepTaker {
  const mutation = useTakeStep(document);
  // The same query, under the same key, every surface reads the review from.
  const { data: answer } = useReviewState(document);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const send = async (
    step: ReviewStep,
    parts: readonly PartReview[],
    comment?: string
  ): Promise<DocumentActionOutcome> => {
    const seen = parts.flatMap(each =>
      each.version === null
        ? []
        : [{ part: each.part, revision: each.revision, version: each.version }]
    );
    if (parts.length === 0 || seen.length !== parts.length) {
      return STEP_NOT_OFFERED;
    }
    setRefusal(null);
    try {
      await mutation.mutateAsync({
        step: step.name,
        parts: parts.map(each => each.part),
        seen,
        ...(comment === undefined ? {} : { comment }),
      });
      toast.success(`${step.label}: done.`);
      return { ok: true };
    } catch (reason) {
      // Said in place as well as in a toast: a refusal can name fields and
      // who could approve instead, more than a toast keeps on screen.
      const message = stepRefusalWords(reason, step.label);
      setRefusal(message);
      toast.error(message);
      return { ok: false, reason: "failed", message, reported: true };
    }
  };

  const take = (
    step: ReviewStep,
    parts: readonly PartReview[]
  ): Promise<DocumentActionOutcome> => {
    // A new step starts without the last one's refusal.
    setRefusal(null);
    // A request for changes always needs a comment; any other step, where its
    // definition says so.
    if (step.kind !== "request-changes" && !step.commentRequired) {
      return send(step, parts);
    }
    return new Promise(resolve => setAsking({ step, parts, resolve }));
  };

  const dialog = (
    <StepCommentDialog
      key={asking?.step.name ?? "closed"}
      open={asking !== null}
      label={asking?.step.label ?? ""}
      asksForChanges={asking?.step.kind === "request-changes"}
      pending={mutation.isPending}
      refusal={refusal}
      onCancel={() => {
        asking?.resolve(CANCELLED);
        setAsking(null);
      }}
      onSend={comment => {
        if (asking === null) return;
        void send(asking.step, freshParts(asking.parts, answer), comment).then(
          outcome => {
            // A refused step keeps the dialog, and the comment, for a retry.
            if (!outcome.ok) return;
            asking.resolve(outcome);
            setAsking(null);
          }
        );
      }}
    />
  );

  return {
    take,
    pending: mutation.isPending,
    refusal,
    clearRefusal: () => setRefusal(null),
    dialog,
  };
}
