"use client";

/**
 * Asks for the comment a step sending work back needs, before it is taken.
 *
 * The comment is required, as the server requires it of every step of kind
 * `request-changes`: the send stays held until there is something to say, and
 * what is sent is trimmed, so a comment of spaces is no comment.
 *
 * @module components/features/entries/review/RequestChangesDialog
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

export interface RequestChangesDialogProps {
  open: boolean;
  /** The step's own label, which titles the dialog and its send. */
  label: string;
  /** Whether the step is on its way. */
  pending: boolean;
  onSend: (comment: string) => void;
  onCancel: () => void;
}

export function RequestChangesDialog({
  open,
  label,
  pending,
  onSend,
  onCancel,
}: RequestChangesDialogProps): JSX.Element {
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
            Say what needs to change. The comment goes with the document back to
            whoever writes it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={fieldId}>Comment</Label>
          <Textarea
            id={fieldId}
            value={comment}
            maxLength={2000}
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
