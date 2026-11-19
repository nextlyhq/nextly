"use client";

/**
 * The media control: the chosen file and its summary, and choosing another
 * from the host's media library.
 *
 * @module media-controls
 */

import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { propLabel } from "../inspector";

import type {
  ContentControlProps,
  ContentServices,
  MediaPickerProps,
  MediaSummary,
  PickedMedia,
} from "./content-services";

/**
 * A media item, chosen from the host's library. Only the id is stored: the
 * page resolves it to the file's current address when it draws, so a file
 * moved or renamed in the library stays right on the page.
 */
export function MediaControl({
  id,
  prop,
  disabled,
  onCommit,
  services,
}: ContentControlProps): React.JSX.Element {
  return (
    <MediaField
      id={id}
      label={propLabel(prop.name, prop.schema)}
      stored={
        typeof prop.value === "string" && prop.value !== "" ? prop.value : null
      }
      accept={
        typeof prop.schema.accept === "string" ? prop.schema.accept : undefined
      }
      disabled={disabled}
      services={services}
      onChange={next => onCommit(prop.name, next)}
    />
  );
}

/**
 * A media field: the chosen file, the button that opens the host's picker,
 * and Remove. Shared by the media control and an image's source, which
 * writes the same id alongside the props it keeps in step.
 */
export function MediaField({
  id,
  label,
  stored,
  accept,
  disabled,
  services,
  showAlt = true,
  onChange,
}: {
  id: string;
  label: string;
  /** The stored id, or `null` for none. */
  stored: string | null;
  accept: string | undefined;
  disabled: boolean;
  services: ContentServices | undefined;
  /** Whether to show the library's alt text under the file's name. */
  showAlt?: boolean;
  /** Store an id, or `undefined` to remove it. */
  onChange: (mediaId: string | undefined) => void;
}): React.JSX.Element {
  // What the last pick was called, for this session; a stored id shows as set.
  const [picked, setPicked] = React.useState<PickedMedia | null>(null);
  const Picker = services?.MediaPicker;
  const name = picked?.id === stored ? picked?.filename : undefined;
  return (
    <div className="nx-inspector__field" data-content-control="media">
      <p className="nx-inspector__field-name" id={`${id}-label`}>
        {label}
      </p>
      <div
        className="nx-inspector__media"
        role="group"
        aria-labelledby={`${id}-label`}
      >
        <ChosenMedia
          mediaId={stored}
          read={services?.readMedia}
          pickedName={name}
          fallback="A file from the media library."
          showAlt={showAlt}
        />
        {Picker === undefined ? (
          <p className="nx-inspector__note">
            The media library is not available here.
          </p>
        ) : (
          <MediaChoice
            Picker={Picker}
            label={label}
            stored={stored}
            accept={accept}
            disabled={disabled}
            onChoose={first => {
              setPicked(first);
              onChange(first.id);
            }}
          />
        )}
        {stored === null ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove ${label}`}
            onClick={() => onChange(undefined)}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A chosen media item as a field shows it: its thumbnail, its name and its
 * alt text, read by its id. Shared with a placement's exposed image, so a
 * stored file reads the same in both. Until it is read, or where it cannot
 * be, the name of the last pick, else a plain sentence that a file is chosen.
 */
export function ChosenMedia({
  mediaId,
  read,
  pickedName,
  fallback,
  showAlt = true,
}: {
  mediaId: string | null;
  read: ContentServices["readMedia"];
  pickedName: string | undefined;
  fallback: string;
  /** Whether to show its library alt text, where a row of its own does not. */
  showAlt?: boolean;
}): React.JSX.Element {
  const summary = useMediaSummary(read, mediaId);
  if (mediaId === null) {
    return <p className="nx-inspector__note">Nothing chosen.</p>;
  }
  const name = summary?.name ?? pickedName ?? fallback;
  return (
    <div className="nx-inspector__media-chosen">
      {summary?.thumbnail === undefined ? null : (
        // Decorative: the name beside it says which file it is.
        <img
          className="nx-inspector__media-thumb"
          src={summary.thumbnail}
          alt=""
        />
      )}
      <div className="nx-inspector__media-text">
        <p className="nx-inspector__media-name" title={name}>
          {name}
        </p>
        {summary?.alt === undefined || !showAlt ? null : (
          // Named as the library's: a page's own Alt text, where the block
          // has one, wins over it, and this is only the fallback.
          <p className="nx-inspector__note">Library alt text: {summary.alt}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The summary of `mediaId`, read once per id; `undefined` until it is read,
 * and for the id it was read for only, so a summary never shows beside
 * another file's id.
 */
export function useMediaSummary(
  read: ContentServices["readMedia"],
  mediaId: string | null
): MediaSummary | null | undefined {
  const [found, setFound] = React.useState<{
    id: string;
    summary: MediaSummary | null;
  }>();
  React.useEffect(() => {
    if (read === undefined || mediaId === null) return;
    let live = true;
    const settle = (summary: MediaSummary | null) => {
      if (live) setFound({ id: mediaId, summary });
    };
    read(mediaId).then(settle, () => settle(null));
    return () => {
      live = false;
    };
  }, [read, mediaId]);
  return found?.id === mediaId ? found.summary : undefined;
}

/**
 * The button that opens the host's media picker, and the picker while open.
 * Shared with a component placement's exposed image, so both choose a file
 * the same way.
 */
export function MediaChoice({
  id,
  Picker,
  label,
  stored,
  selected = stored,
  accept,
  disabled,
  onChoose,
}: {
  /** The button's id, for a field label that names it. */
  id?: string;
  Picker: React.ComponentType<MediaPickerProps>;
  label: string;
  stored: string | null;
  /**
   * The media id the library opens with selected: what `stored` names, unless
   * a field stores something other than an id (a background's address).
   */
  selected?: string | null;
  accept: string | undefined;
  disabled: boolean;
  onChoose: (media: PickedMedia) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        {...(id === undefined ? {} : { id })}
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-label={`Choose ${label}`}
        onClick={() => setOpen(true)}
      >
        {stored === null ? "Choose" : "Replace"}
      </Button>
      {/*
        Mounted only while open, so each opening starts from what the prop
        stores now rather than from the picker's last choice, which could
        belong to another block and be restored by a confirm.
      */}
      {open ? (
        <Picker
          open
          onOpenChange={setOpen}
          title={`Choose ${label.toLowerCase()}`}
          {...(accept === undefined ? {} : { accept })}
          initialSelectedIds={new Set(selected === null ? [] : [selected])}
          onSelect={media => {
            const first = media[0];
            // Closed here: the picker leaves closing to whoever opened it,
            // and left open it would sit over a choice already made.
            setOpen(false);
            if (first !== undefined) onChoose(first);
          }}
        />
      ) : null}
    </>
  );
}
