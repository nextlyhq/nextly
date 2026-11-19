"use client";

/**
 * Taking a workflow step on some parts of a document, as the editor's header
 * and the side panel's Review section both do: sent with what the person saw
 * of each part, asking first for the comment a step needs, and said in a toast
 * either way. One implementation, so a step taken from either place is sent,
 * asked and reported alike.
 *
 * @module components/features/entries/review/useStepTaker
 * @experimental
 */

import { useState, type ReactNode } from "react";

import { toast } from "@admin/components/ui";
import { useTakeStep } from "@admin/hooks/queries/useReviewState";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import type { DocumentActionOutcome } from "../EntryForm/useDocumentActionBindings";

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
  /** The comment dialog, to mount once. */
  dialog: ReactNode;
}

export function useStepTaker(
  document: ReleaseDocumentRef | undefined
): StepTaker {
  const mutation = useTakeStep(document);
  const [asking, setAsking] = useState<Asking | null>(null);

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
      const message = apiErrorMessage(
        reason,
        `${step.label} didn't go through.`
      );
      toast.error(message);
      return { ok: false, reason: "failed", message, reported: true };
    }
  };

  const take = (
    step: ReviewStep,
    parts: readonly PartReview[]
  ): Promise<DocumentActionOutcome> => {
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
      onCancel={() => {
        asking?.resolve(CANCELLED);
        setAsking(null);
      }}
      onSend={comment => {
        if (asking === null) return;
        void send(asking.step, asking.parts, comment).then(outcome => {
          // A refused step keeps the dialog, and the comment, for a retry.
          if (!outcome.ok) return;
          asking.resolve(outcome);
          setAsking(null);
        });
      }}
    />
  );

  return { take, pending: mutation.isPending, dialog };
}
