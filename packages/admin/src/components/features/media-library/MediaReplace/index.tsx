"use client";

/**
 * MediaReplace
 *
 * Replace an item's file and keep the item. Replace opens the file chooser;
 * a file of the same kind, for an item nothing names by its address,
 * replaces the old one at once. Otherwise the person is asked first: a file
 * of another kind (an image replaced by a PDF) leaves the alt text and the
 * focus point behind, and rich text and email templates naming the item by
 * its address keep showing the previous image until they are edited, each
 * listed as Used in lists them. The library owns the request; this owns the
 * chooser and the question.
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

import { fetchMediaUsage, type MediaUsage } from "../media-library-api";
import { MediaUsageList, placesText, usageTotal } from "../MediaUsedIn";

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

/** A Replace waiting on the person: the item, the file, and what to say. */
interface PendingReplace {
  media: Media;
  file: File;
  kindChanges: boolean;
  /** The uses naming the item by address; `null` when they could not be read. */
  addressUses: MediaUsage | null;
}

/** What the person is told before a Replace that needs asking about. */
function ReplaceQuestion({
  pending,
}: {
  pending: PendingReplace;
}): React.JSX.Element {
  const { media, file, kindChanges, addressUses } = pending;
  const kept = addressUses ? usageTotal(addressUses) : 0;
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {kindChanges
            ? `Replace ${KIND_NAMES[getMediaType(media.mimeType)]} with ${KIND_NAMES[getMediaType(file.type)]}?`
            : `Replace ${media.originalFilename}?`}
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="flex flex-col gap-2">
            {kindChanges && (
              <p>
                {media.originalFilename} keeps its place everywhere it is used,
                but its alt text and focus point won&apos;t apply to {file.name}
                .
              </p>
            )}
            {kept > 0 && (
              <p>
                {placesText(kept)} {kept === 1 ? "shows" : "show"} this image by
                its address (rich text and email templates) and{" "}
                {kept === 1 ? "keeps" : "keep"} the previous image until{" "}
                {kept === 1 ? "it's" : "they're"} edited.
              </p>
            )}
            {addressUses === null && (
              <p>
                Couldn&apos;t check whether rich text or email templates show
                this image by its address. Any that do keep the previous image
                until they&apos;re edited.
              </p>
            )}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      {addressUses && kept > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border px-3 py-1">
          <MediaUsageList usage={addressUses} />
        </div>
      )}
    </>
  );
}

/**
 * The chooser and the question; `start(media)` begins a replace. Before a
 * file goes, the item's address uses are asked for, so the person is told
 * which pages keep the previous image.
 */
export function useMediaReplace(
  onReplace: (media: Media, file: File) => void
): {
  start: (media: Media) => void;
  element: React.JSX.Element;
} {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [target, setTarget] = React.useState<Media | null>(null);
  const [pending, setPending] = React.useState<PendingReplace | null>(null);

  const start = React.useCallback((media: Media) => {
    setTarget(media);
    inputRef.current?.click();
  }, []);

  const choose = async (media: Media, file: File) => {
    const addressUses = await fetchMediaUsage(media.id, {
      byAddress: true,
    }).catch(() => null);
    const kindChanges = changesKind(media, file);
    if (!kindChanges && addressUses && usageTotal(addressUses) === 0) {
      onReplace(media, file);
      return;
    }
    setPending({ media, file, kindChanges, addressUses });
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared, so choosing the same file again still reports a change.
    event.target.value = "";
    if (!file || !target) return;
    void choose(target, file);
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
          {pending && <ReplaceQuestion pending={pending} />}
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
