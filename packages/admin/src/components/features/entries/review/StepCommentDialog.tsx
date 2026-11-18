"use client";

/**
 * Asks for the comment a step needs before it is taken: a request for
 * changes always, and any other step whose definition requires one.
 *
 * The comment is required, as the step refuses one taken without: the send
 * stays held until there is something to say, and what is sent is trimmed, so
 * a comment of spaces is no comment.
 *
 * @module components/features/entries/review/StepCommentDialog
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
import { useId, useState, type JSX } from "react";

import { Loader2 } from "@admin/components/icons";

/**
 * The longest comment a step keeps, as the server's step refuses a longer one
 * (its `MAX_STEP_COMMENT_LENGTH`, the content events' note limit). The admin
 * cannot import the server's constant, so it is stated here, once.
 */
export const STEP_COMMENT_MAX_LENGTH = 4000;

export interface StepCommentDialogProps {
  open: boolean;
  /** The step's own label, which titles the dialog and its send. */
  label: string;
  /** Whether the step is on its way. */
  pending: boolean;
  /** Whether the step sends the work back for changes, which the prompt says. */
  asksForChanges: boolean;
  onSend: (comment: string) => void;
  onCancel: () => void;
}

export function StepCommentDialog({
  open,
  label,
  pending,
  asksForChanges,
  onSend,
  onCancel,
}: StepCommentDialogProps): JSX.Element {
  const [comment, setComment] = useState("");
  const fieldId = useId();
  const trimmed = comment.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (next || pending) return;
        setComment("");
        onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {asksForChanges
              ? "Say what needs to change. The comment goes with the document back to whoever writes it."
              : "This step needs a comment. It is kept with the step in the document's history."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={fieldId}>Comment</Label>
          <Textarea
            id={fieldId}
            value={comment}
            maxLength={STEP_COMMENT_MAX_LENGTH}
            disabled={pending}
            onChange={event => setComment(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setComment("");
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || trimmed === ""}
            onClick={() => onSend(trimmed)}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
