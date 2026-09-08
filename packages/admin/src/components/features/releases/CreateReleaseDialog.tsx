"use client";

/**
 * Naming a release, which is all it takes to start one.
 *
 * Deliberately asks for a title and nothing else. A release is assembled before
 * it is committed — documents go in, and the instant is chosen last, on the
 * detail page where its contents are visible. Asking for a date here would put
 * the decision at the moment an editor has the least information: an empty
 * release whose contents nobody has seen.
 *
 * @module components/features/releases/CreateReleaseDialog
 */

import { useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@admin/components/ui";
import { useCreateRelease } from "@admin/hooks/queries/useReleases";
import type { Release } from "@admin/types/releases";

import { releaseErrorMessage } from "./release-error";

export interface CreateReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the release that was created, so the caller can open it. */
  onCreated?: (release: Release) => void;
}

export function CreateReleaseDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateReleaseDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const create = useCreateRelease();

  const trimmed = title.trim();
  // No length rule here. The cap is a property of the narrowest dialect's
  // column and the server states it in its refusal, naming the field and the
  // number; a copy in this file would be a second implementation of that
  // boundary and would start rejecting titles the server accepts the moment the
  // storage contract moves.
  const canSubmit = trimmed.length > 0 && !create.isPending;

  // ONE close path. The visible Cancel button called the setter directly and so
  // skipped this — and the dialog stays mounted on the releases page, so
  // reopening restored a name the editor had discarded, along with the error
  // from any previous attempt.
  const close = () => {
    setTitle("");
    setDescription("");
    create.reset();
    onOpenChange(false);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    create.mutate(
      {
        title: trimmed,
        // An empty box means "no description", not an empty one. The column is
        // nullable and a blank string would make a release that HAS a
        // description whose text happens to be nothing.
        description: description.trim() || null,
      },
      {
        onSuccess: result => {
          close();
          onCreated?.(result.item);
        },
      }
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // Closing discards the draft. Keeping it would offer a half-typed title
        // back the next time somebody opened this from a different page, which
        // reads as the form remembering something it was never told to keep.
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New release</DialogTitle>
            <DialogDescription>
              Give it a name you will recognise on the day. You will add
              documents and choose the moment next.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="release-title">Name</Label>
              <Input
                id="release-title"
                value={title}
                autoFocus
                onChange={event => setTitle(event.target.value)}
                placeholder="Spring launch"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="release-description">
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="release-description"
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="What is going live, and why it goes together."
                rows={3}
              />
            </div>

            {create.isError ? (
              // The server refuses generically, so this says what it can say
              // truthfully — that the release was not created — rather than
              // inventing a reason from an error that carries none.
              <p role="alert" className="text-sm text-destructive">
                {releaseErrorMessage(
                  create.error,
                  "The release could not be created."
                )}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending ? "Creating…" : "Create release"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
