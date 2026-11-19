"use client";

/**
 * "Approve all languages": every part waiting for this person's approval,
 * each with its changes (collapsed, opened one at a time), approved in one
 * step for exactly the versions shown.
 *
 * Where a part moved while the reviewer looked, the server refuses the whole
 * step; the review state and the parts' versions are read again, the dialog
 * shows their changes anew and says which part changed, and nothing is
 * approved until the reviewer approves again. Parts left out are named before
 * (from the review state) and after (from the step's own answer).
 *
 * @module components/features/entries/review/ApproveAllDialog
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type JSX } from "react";

import { VersionDiffView } from "@admin/components/features/versions/diff/VersionDiffView";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { useTakeStep } from "@admin/hooks/queries/useReviewState";
import { versionKeys } from "@admin/hooks/queries/useVersions";
import {
  editorMainAction,
  useDialogReturnFocus,
} from "@admin/hooks/useDialogReturnFocus";
import type { VersionScope } from "@admin/services/versionApi";
import type { PartReview } from "@admin/types/workflows";

import {
  listWords,
  outWords,
  seenOf,
  staleParts,
  type ApproveAll,
} from "./approve-all";
import {
  partPairWords,
  reviewDocumentOf,
  usePartName,
  usePartPair,
} from "./part-changes";
import { announceReview } from "./step-announcement";
import { stepRefusalWords } from "./step-refusal";
import { STEP_COMMENT_MAX_LENGTH } from "./StepCommentDialog";

export interface ApproveAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document, as the history names it. */
  scope: VersionScope;
  /** The approval, as `approveAllOf` reads it from the review state on screen. */
  approval: ApproveAll;
  /** Why the approval cannot be sent at this moment, where something holds it. */
  hold?: string | undefined;
}

export function ApproveAllDialog({
  open,
  onOpenChange,
  scope,
  approval,
  hold,
}: ApproveAllDialogProps): JSX.Element {
  const document = reviewDocumentOf(scope);
  const mutation = useTakeStep(document);
  // Opened from state, so focus is handed back by hand when it closes: to
  // "Approve all languages…", or, where the approval has redrawn the page
  // without it, to the editor's main action.
  const returnFocus = useDialogReturnFocus(open, editorMainAction);
  const queryClient = useQueryClient();
  const nameOf = usePartName();
  // Inside a sentence the shared part reads in lower case.
  const sayName = (part: string | null): string =>
    part === null ? "shared fields" : nameOf(part);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [refusal, setRefusal] = useState<string | null>(null);
  // An approval whose definition asks for a comment is sent with one, asked
  // here once for every part it approves.
  const [comment, setComment] = useState("");
  const commentId = useId();
  const asksComment = approval.step.commentRequired;
  const trimmed = comment.trim();
  const keyOf = (part: string | null): string => part ?? "";
  const names = listWords(approval.listed.map(part => sayName(part.part)));
  const label = `Approve ${names}`;

  const approve = async (): Promise<void> => {
    // Held as the header's steps are: nothing is sent meanwhile.
    if (hold !== undefined) return;
    // The server refuses an approval its definition asks a comment for
    // without one: none is sent until there is something to say.
    if (asksComment && trimmed === "") return;
    setRefusal(null);
    try {
      await mutation.mutateAsync({
        step: approval.step.name,
        parts: approval.parts,
        seen: seenOf(approval.listed),
        ...(asksComment ? { comment: trimmed } : {}),
      });
      // The parts left out are those the dialog named before it was sent:
      // the step names only the listed parts, so the server leaves none.
      const left = approval.out.map(part =>
        outWords(part, nameOf(part.part), approval.step.name)
      );
      // Said to assistive technology as well as in the toast: the approval is
      // the dialog's whole point, and the dialog closes on it.
      announceReview(`Approved ${names}, each for the version you saw.`);
      toast.success(
        [`Approved ${names}, each for the version you saw.`, ...left]
          .map(sentence => (sentence.endsWith(".") ? sentence : `${sentence}.`))
          .join(" ")
      );
      onOpenChange(false);
    } catch (reason) {
      const moved = staleParts(reason);
      if (moved === undefined) {
        // Drawn in the dialog as an alert, which assistive technology reads.
        setRefusal(stepRefusalWords(reason, approval.step.label));
        return;
      }
      // The review state is read again by the step itself; the versions
      // compared are read again here, so the changes shown are the new ones.
      void queryClient.invalidateQueries({ queryKey: versionKeys.lists() });
      const which =
        moved.length === 0 ? "A part" : listWords(moved.map(sayName));
      setRefusal(
        `${capitalized(which)} changed while you looked, so nothing was approved. The changes are shown again: look them over, then approve.`
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (mutation.isPending) return;
        if (!next) setRefusal(null);
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
        onCloseAutoFocus={returnFocus}
      >
        <DialogHeader>
          <DialogTitle>Approve all languages</DialogTitle>
          <DialogDescription>
            Look over each part&apos;s changes, then approve them together.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2" aria-label="Parts to approve">
          {approval.listed.map(part => (
            <PartRow
              key={keyOf(part.part)}
              scope={scope}
              part={part}
              name={nameOf(part.part)}
              open={opened.has(keyOf(part.part))}
              onToggle={() =>
                setOpened(current => {
                  const next = new Set(current);
                  if (next.has(keyOf(part.part))) next.delete(keyOf(part.part));
                  else next.add(keyOf(part.part));
                  return next;
                })
              }
            />
          ))}
        </ul>
        {approval.out.length === 0 ? null : (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium">Left out</p>
            <ul className="space-y-0.5">
              {approval.out.map(part => (
                <li key={keyOf(part.part)}>
                  {outWords(part, nameOf(part.part), approval.step.name)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {asksComment ? (
          <div className="space-y-2">
            <Label htmlFor={commentId}>Comment</Label>
            <Textarea
              id={commentId}
              value={comment}
              maxLength={STEP_COMMENT_MAX_LENGTH}
              disabled={mutation.isPending}
              onChange={event => setComment(event.target.value)}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Each part is approved for exactly the version shown here. If any
          changes while you look, nothing is approved.
        </p>
        {refusal === null ? null : (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {refusal}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => {
              setRefusal(null);
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              mutation.isPending ||
              hold !== undefined ||
              (asksComment && trimmed === "")
            }
            title={hold}
            onClick={() => void approve()}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One part: its name and what its changes are against, opening to the comparison. */
function PartRow({
  scope,
  part,
  name,
  open,
  onToggle,
}: {
  scope: VersionScope;
  part: PartReview;
  name: string;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const read = usePartPair(scope, part, true);
  const { pair } = read;
  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">
          {partPairWords(read)}
          {read.note === undefined ? null : ` ${read.note}`}
        </span>
      </button>
      {open && pair?.kind === "pair" ? (
        <div className="border-t border-border px-3 py-2">
          <VersionDiffView
            scope={scope}
            from={pair.from}
            to={pair.to}
            // A pair the server resolved already holds its comparison.
            {...(pair.seededBy === undefined
              ? {}
              : { seededBy: pair.seededBy })}
          />
        </div>
      ) : null}
    </li>
  );
}

function capitalized(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
