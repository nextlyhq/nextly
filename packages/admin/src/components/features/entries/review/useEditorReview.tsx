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
 * Whether the person may take a step is read from their permissions: the
 * review state names each step leaving the stage but not the permission it
 * needs, so a step that sends work on (submit, move) is held by whoever may
 * edit the document, and one that judges it (approve, request changes) by
 * whoever holds `approve-<slug>`, or is the person the part waits for. The
 * server decides each step as it is taken; a refusal is said where it
 * happens.
 *
 * @module components/features/entries/review/useEditorReview
 * @experimental
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { toast } from "@admin/components/ui";
import {
  reviewKeys,
  useReviewState,
  useTakeStep,
} from "@admin/hooks/queries/useReviewState";
import { useCurrentUserId } from "@admin/hooks/useCurrentUserId";
import { useHasPermission } from "@admin/hooks/useHasPermission";
import { useLocalization } from "@admin/hooks/useLocalization";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import {
  leadingReviewStep,
  type ReviewActionState,
} from "../EntryForm/document-actions";
import type {
  DocumentActionOutcome,
  DocumentReviewBinding,
} from "../EntryForm/useDocumentActionBindings";

import { RequestChangesDialog } from "./RequestChangesDialog";
import { partsOnScreen, waitingForWords } from "./review-words";

export interface EditorReviewInput {
  /** The document, once it exists; nothing is asked before. */
  document: ReleaseDocumentRef | undefined;
  /** The language being edited; the default language where none is named. */
  locale: string | undefined;
  /** Whether the person may change the document, which a submission needs. */
  canEdit: boolean;
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
  /** The dialog a step needing a comment asks with. */
  dialog: ReactNode;
}

/** What a step resolves with where it cannot be sent at all. */
const NOT_OFFERED: DocumentActionOutcome = {
  ok: false,
  reason: "refused",
  message: "This step isn't offered for this document.",
};

const CANCELLED: DocumentActionOutcome = {
  ok: false,
  reason: "cancelled",
  message: "Cancelled.",
};

/** A comment being asked for, and who waits for the answer. */
interface Asking {
  step: ReviewStep;
  resolve: (outcome: DocumentActionOutcome) => void;
}

export function useEditorReview({
  document,
  locale,
  canEdit,
  isDirty,
  storedStamp,
}: EditorReviewInput): EditorReview {
  const query = useReviewState(document);
  const { defaultLocale } = useLocalization();
  const has = useHasPermission();
  const me = useCurrentUserId();
  const mutation = useTakeStep(document);
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<Asking | null>(null);

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

  const onScreen = partsOnScreen(query.data, locale ?? defaultLocale);
  const part = onScreen[0]?.stage === null ? undefined : onScreen[0];

  if (document === undefined || part === undefined) {
    return { binding: undefined, part: undefined, dialog: null };
  }

  const leading = leadingReviewStep(part.steps);
  const waitsForMe =
    part.waitingFor?.kind === "user" && part.waitingFor.id === me;
  const holds = (step: ReviewStep): boolean =>
    step.kind === "submit" || step.kind === "move"
      ? canEdit
      : has(`approve-${document.scopeSlug}`) ||
        (waitsForMe && step === leading);

  const send = async (
    step: ReviewStep,
    comment?: string
  ): Promise<DocumentActionOutcome> => {
    const seen = onScreen.flatMap(each =>
      each.version === null
        ? []
        : [{ part: each.part, revision: each.revision, version: each.version }]
    );
    if (seen.length !== onScreen.length) return NOT_OFFERED;
    try {
      await mutation.mutateAsync({
        step: step.name,
        parts: onScreen.map(each => each.part),
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

  const takeStep = (name: string): Promise<DocumentActionOutcome> => {
    const step = part.steps.find(candidate => candidate.name === name);
    if (step === undefined || !holds(step)) return Promise.resolve(NOT_OFFERED);
    if (step.kind !== "request-changes") return send(step);
    return new Promise(resolve => setAsking({ step, resolve }));
  };

  const state: ReviewActionState = {
    stageLabel: part.stageLabel ?? part.stage ?? "",
    publishable: part.publishable,
    steps: part.steps.map(step => ({
      name: step.name,
      label: step.label,
      kind: step.kind,
      held: holds(step),
    })),
    waitingFor: waitingForWords(part.waitingFor),
    ...stepHold(isDirty, onScreen),
  };

  const dialog = (
    <RequestChangesDialog
      key={asking?.step.name ?? "closed"}
      open={asking !== null}
      label={asking?.step.label ?? ""}
      pending={mutation.isPending}
      onCancel={() => {
        asking?.resolve(CANCELLED);
        setAsking(null);
      }}
      onSend={comment => {
        if (asking === null) return;
        void send(asking.step, comment).then(outcome => {
          // A refused step keeps the dialog, and the comment, for a retry.
          if (!outcome.ok) return;
          asking.resolve(outcome);
          setAsking(null);
        });
      }}
    />
  );

  return { binding: { state, takeStep }, part, dialog };
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
