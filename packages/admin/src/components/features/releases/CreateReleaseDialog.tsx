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

/**
 * The server's own cap, restated where a person can see it before they hit it.
 *
 * The column is 255 characters in the narrowest dialect, so a longer title is
 * refused at the write. Counting here turns that refusal into something an
 * editor can avoid rather than something they discover after typing.
 */
const MAX_TITLE = 255;

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
  const tooLong = trimmed.length > MAX_TITLE;
  const canSubmit = trimmed.length > 0 && !tooLong && !create.isPending;

  const reset = () => {
    setTitle("");
    setDescription("");
    create.reset();
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
          reset();
          onOpenChange(false);
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
        if (!next) reset();
        onOpenChange(next);
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
                aria-invalid={tooLong || undefined}
                aria-describedby={tooLong ? "release-title-error" : undefined}
              />
              {tooLong ? (
                <p
                  id="release-title-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  Names are limited to {MAX_TITLE} characters.
                </p>
              ) : null}
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
                The release could not be created.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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
