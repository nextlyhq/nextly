"use client";

/**
 * MediaReplace
 *
 * Replace an item's file and keep the item. Replace opens the file chooser;
 * a file of the same kind, for an item nothing names by its address,
 * replaces the old one at once. Otherwise the person is asked first: a file
 * of another kind (an image replaced by a PDF) leaves the alt text and the
 * focus point behind; rich text, email templates, avatars and logos naming
 * the item by its address keep showing the previous image until they are
 * edited, the documents listed as Used in lists them; and while the usage
 * record is still being built, the previous file is kept whatever it lists.
 * The library owns the request; this owns the chooser and the question.
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

/**
 * How many places name the item by its address: the documents, readable or
 * not, and the avatars and logos.
 */
function addressUseCount(usage: MediaUsage): number {
  return usageTotal(usage) + usage.heldByAddress;
}

/** What names the item by its address, as the question says it. */
function addressUseKinds(usage: MediaUsage): string {
  const documents = usageTotal(usage) > 0;
  if (usage.heldByAddress === 0) return "rich text and email templates";
  return documents
    ? "rich text, email templates, avatars and logos"
    : "avatars and logos";
}

/** The question's title: the change of kind, or the item's name. */
function replaceTitle({ media, file, kindChanges }: PendingReplace): string {
  return kindChanges
    ? `Replace ${KIND_NAMES[getMediaType(media.mimeType)]} with ${KIND_NAMES[getMediaType(file.type)]}?`
    : `Replace ${media.originalFilename}?`;
}

/** How many places keep the previous image, and what they are; none, nothing. */
function AddressUseNote({
  usage,
}: {
  usage: MediaUsage;
}): React.JSX.Element | null {
  const kept = addressUseCount(usage);
  if (kept === 0) return null;
  const one = kept === 1;
  return (
    <p>
      {placesText(kept)} {one ? "shows" : "show"} this image by its address (
      {addressUseKinds(usage)}) and {one ? "keeps" : "keep"} the previous image
      until {one ? "it's" : "they're"} edited.
    </p>
  );
}

/**
 * What a Replace leaves behind, as far as the uses by address could be read:
 * the places keeping the previous image, a record still being built, or that
 * they could not be read at all.
 */
function AddressUseNotes({
  usage,
}: {
  usage: MediaUsage | null;
}): React.JSX.Element {
  if (usage === null) {
    return (
      <p>
        Couldn&apos;t check whether rich text or email templates show this image
        by its address. Any that do keep the previous image until they&apos;re
        edited.
      </p>
    );
  }
  return (
    <>
      <AddressUseNote usage={usage} />
      {!usage.usageRecorded && (
        <p>
          The usage record is still being built, so the previous file is kept.
        </p>
      )}
    </>
  );
}

/** What the person is told before a Replace that needs asking about. */
function ReplaceQuestion({
  pending,
}: {
  pending: PendingReplace;
}): React.JSX.Element {
  const { media, file, kindChanges, addressUses } = pending;
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{replaceTitle(pending)}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="flex flex-col gap-2">
            {kindChanges && (
              <p>
                {media.originalFilename} keeps its place everywhere it is used,
                but its alt text and focus point won&apos;t apply to {file.name}
                .
              </p>
            )}
            <AddressUseNotes usage={addressUses} />
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      {addressUses && usageTotal(addressUses) > 0 && (
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
    // At once only when nothing keeps the previous file: no use by address,
    // and a usage record that can say so.
    if (
      !kindChanges &&
      addressUses &&
      addressUseCount(addressUses) === 0 &&
      addressUses.usageRecorded
    ) {
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
