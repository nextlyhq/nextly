"use client";

/**
 * MediaReplace
 *
 * Replace an item's file and keep the item. Replace opens the file chooser;
 * a file of the same kind replaces the old one at once, while one of another
 * kind (an image replaced by a PDF) is asked about first, since the alt text
 * and the focus point stop applying. The library owns the request; this owns
 * the chooser and the question.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nextlyhq/ui";
import * as React from "react";

import { getMediaType } from "@admin/lib/media-utils";
import type { Media, MediaType } from "@admin/types/media";

const KIND_NAMES: Record<MediaType, string> = {
  image: "an image",
  video: "a video",
  audio: "an audio file",
  document: "a document",
  other: "a file",
};

/** Whether a new file is a different kind of thing from the item's own. */
function changesKind(media: Media, file: File): boolean {
  return getMediaType(media.mimeType) !== getMediaType(file.type);
}

/** The chooser and the question; `start(media)` begins a replace. */
export function useMediaReplace(
  onReplace: (media: Media, file: File) => void
): {
  start: (media: Media) => void;
  element: React.JSX.Element;
} {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [target, setTarget] = React.useState<Media | null>(null);
  const [pending, setPending] = React.useState<{
    media: Media;
    file: File;
  } | null>(null);

  const start = React.useCallback((media: Media) => {
    setTarget(media);
    inputRef.current?.click();
  }, []);

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared, so choosing the same file again still reports a change.
    event.target.value = "";
    if (!file || !target) return;
    if (changesKind(target, file)) {
      setPending({ media: target, file });
      return;
    }
    onReplace(target, file);
  };

  const element = (
    <>
      {/* The chooser Replace opens. Replace is what a person and a screen
          reader meet, so the input itself is hidden from both. */}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="media-replace-input"
        onChange={onChange}
      />
      <AlertDialog
        open={pending !== null}
        onOpenChange={open => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace {KIND_NAMES[getMediaType(pending?.media.mimeType)]} with{" "}
              {KIND_NAMES[getMediaType(pending?.file.type)]}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.media.originalFilename} keeps its place everywhere it is
              used, but its alt text and focus point won&apos;t apply to{" "}
              {pending?.file.name}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onReplace(pending.media, pending.file);
                setPending(null);
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return { start, element };
}
