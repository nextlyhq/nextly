"use client";

/**
 * MediaDetails
 *
 * The parts of an item's details, shared by the side panel and the
 * full-screen viewer so both read and edit an item the same way: the preview
 * with its focus point, the text fields that save themselves, the file's
 * facts, and the actions. Each part renders; the library owns the requests.
 */

import { Badge, Button, Input, Label, Textarea } from "@nextlyhq/ui";
import * as React from "react";

import {
  Copy,
  Download,
  File,
  FileText,
  FolderInput,
  Music,
  Trash2,
  Video,
} from "@admin/components/icons";
import {
  MEDIA_ALT_TEXT_MAX_LENGTH,
  MEDIA_CAPTION_MAX_LENGTH,
  MEDIA_DESTRUCTIVE_TEXT_CLASSES,
} from "@admin/constants/media";
import {
  formatFileSize,
  formatUploadedDate,
  getMediaType,
  mediaImageSrc,
} from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { Media, MediaUpdateInput } from "@admin/types/media";

import { MediaFocalPoint } from "../MediaFocalPoint";

import {
  useMediaFieldAutosave,
  type MediaFieldSaveState,
} from "./useMediaFieldAutosave";

/**
 * Saves a change to one item, named by id: a save on the way out of an item
 * is sent after the details have moved on to the next one. Rejects when the
 * server refuses it.
 */
export type MediaSave = (
  mediaId: string,
  updates: MediaUpdateInput
) => Promise<void>;

/**
 * What a person may do from the details, as callbacks. An action left out is
 * one this person may not take, so it is not offered: a reader gets Copy URL
 * and Download, and nothing that writes.
 */
export interface MediaDetailsActionHandlers {
  onCopyUrl: (media: Media) => void;
  onDownload: (media: Media) => void;
  onMove?: (media: Media) => void;
  onDelete?: (media: Media) => void;
}

const isImageMedia = (media: Media): boolean =>
  getMediaType(media.mimeType) === "image";

/**
 * The left and right arrows move to the previous and next item, unless they
 * are moving a caret or a control's own value. The panel and the viewer both
 * use this, so the keys mean the same in each.
 */
export function handleItemArrowKeys(
  event: React.KeyboardEvent<HTMLElement>,
  onPrevious: (() => void) | undefined,
  onNext: (() => void) | undefined
): void {
  if (event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        "input, textarea, select, [role='slider'], [role='listbox'], [role='menu']"
      ))
  ) {
    return;
  }
  const move = event.key === "ArrowLeft" ? onPrevious : onNext;
  if (!move) return;
  event.preventDefault();
  move();
}

const TYPE_ICONS = {
  video: Video,
  audio: Music,
  document: FileText,
  image: File,
  other: File,
} as const;

/**
 * The item itself: an image whole, with its focus point, or a file's icon
 * and name where there is no picture to show.
 */
export function MediaPreview({
  media,
  onSave,
  readOnly,
  imageClassName,
}: {
  media: Media;
  onSave: MediaSave;
  readOnly: boolean;
  imageClassName?: string;
}): React.JSX.Element {
  if (isImageMedia(media) && media.url) {
    return (
      <MediaFocalPoint
        // The original, not the thumbnail: the stored thumbnail is a square
        // crop, and a point placed on a crop lands somewhere else on the image.
        src={mediaImageSrc(media, { purpose: "preview" })}
        alt={media.altText || media.originalFilename}
        focalX={media.focalX}
        focalY={media.focalY}
        readOnly={readOnly}
        imageClassName={imageClassName}
        onSave={point => onSave(media.id, point)}
      />
    );
  }
  const Icon = TYPE_ICONS[getMediaType(media.mimeType)];
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted p-6 text-center">
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <span className="max-w-full truncate text-sm text-muted-foreground">
        {media.originalFilename}
      </span>
    </div>
  );
}

/** The line under a field that says how its save went. */
function FieldSaveStatus({
  state,
  onRetry,
  label,
  maxLength,
}: {
  state: MediaFieldSaveState;
  onRetry: () => void;
  label: string;
  maxLength: number;
}): React.JSX.Element {
  const isProblem = state === "failed" || state === "too-long";
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-2 text-xs">
      {/* Always in the page, so a screen reader is already listening when
          "Saved" or the failure arrives; a live region that appears with its
          text is often not read. */}
      <span
        role="status"
        className={cn(
          isProblem ? MEDIA_DESTRUCTIVE_TEXT_CLASSES : "text-muted-foreground",
          state === "saved" && "text-success"
        )}
      >
        {state === "saving" && "Saving…"}
        {state === "saved" && "Saved"}
        {state === "failed" &&
          "Couldn't save. Your text is still here to try again."}
        {state === "too-long" &&
          `Not saved: ${label} can be at most ${maxLength} characters.`}
      </span>
      {state === "failed" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
    </div>
  );
}

/** One text field of an item, saved when it loses focus. */
function AutosaveField({
  media,
  field,
  label,
  multiline,
  placeholder,
  help,
  marker,
  maxLength,
  onSave,
}: {
  media: Media;
  field: "altText" | "caption";
  label: string;
  multiline?: boolean;
  placeholder: string;
  help?: string;
  marker?: React.ReactNode;
  /** The longest text the field takes and saves. */
  maxLength: number;
  onSave: MediaSave;
}): React.JSX.Element {
  const id = React.useId();
  const helpId = `${id}-help`;
  const save = React.useCallback(
    (itemId: string, value: string) => onSave(itemId, { [field]: value }),
    [field, onSave]
  );
  const autosave = useMediaFieldAutosave({
    itemId: media.id,
    savedValue: media[field] ?? "",
    save,
    fieldLabel: label,
    maxLength,
  });
  const shared = {
    id,
    value: autosave.value,
    placeholder,
    "aria-describedby": help ? helpId : undefined,
    maxLength,
    onBlur: autosave.onBlur,
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        className="flex items-center gap-2 text-sm font-medium"
      >
        {label}
        {marker}
      </Label>
      {multiline ? (
        <Textarea
          {...shared}
          rows={2}
          onChange={event => autosave.onChange(event.target.value)}
        />
      ) : (
        <Input
          {...shared}
          onChange={event => autosave.onChange(event.target.value)}
        />
      )}
      {help && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      <FieldSaveStatus
        state={autosave.state}
        onRetry={autosave.retry}
        label={label}
        maxLength={maxLength}
      />
    </div>
  );
}

/**
 * Alt text and caption, each saved when it loses focus. A reader sees the
 * same words as text.
 */
export function MediaDetailsFields({
  media,
  onSave,
  readOnly,
}: {
  media: Media;
  onSave: MediaSave;
  readOnly: boolean;
}): React.JSX.Element {
  const isImage = isImageMedia(media);
  const missingAlt = isImage && !media.altText;

  if (readOnly) {
    return (
      <dl className="flex flex-col gap-3 text-sm">
        {isImage && (
          <div className="flex flex-col gap-1">
            <dt className="flex items-center gap-2 font-medium">
              Alt text
              {missingAlt && <MissingAltBadge />}
            </dt>
            <dd className="text-muted-foreground">{media.altText || "None"}</dd>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <dt className="font-medium">Caption</dt>
          <dd className="text-muted-foreground">{media.caption || "None"}</dd>
        </div>
      </dl>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {isImage && (
        <AutosaveField
          media={media}
          field="altText"
          label="Alt text"
          placeholder="Describe what the image shows"
          help="Read by screen readers and search engines. Leave it empty only for decoration."
          marker={missingAlt ? <MissingAltBadge /> : null}
          maxLength={MEDIA_ALT_TEXT_MAX_LENGTH}
          onSave={onSave}
        />
      )}
      <AutosaveField
        media={media}
        field="caption"
        label="Caption"
        placeholder="Optional"
        multiline
        maxLength={MEDIA_CAPTION_MAX_LENGTH}
        onSave={onSave}
      />
    </div>
  );
}

function MissingAltBadge(): React.JSX.Element {
  return (
    <Badge variant="warning" className="text-xs font-semibold">
      Missing
    </Badge>
  );
}

/** The file's facts: type, dimensions, size, folder and when it arrived. */
export function MediaFileFacts({
  media,
  folderName,
}: {
  media: Media;
  /** The folder's name, or null for an item at the top level. */
  folderName: string | null;
}): React.JSX.Element {
  const rows: Array<[string, string]> = [
    ["Type", media.mimeType],
    ...(media.width && media.height
      ? ([["Dimensions", `${media.width} × ${media.height}`]] as Array<
          [string, string]
        >)
      : []),
    ["Size", formatFileSize(media.size)],
    ["Folder", folderName ?? "No folder"],
    ["Uploaded", formatUploadedDate(media.uploadedAt)],
  ];
  return (
    <section aria-label="File" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">File</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([term, value]) => (
          <React.Fragment key={term}>
            <dt className="text-muted-foreground">{term}</dt>
            <dd
              className="min-w-0 truncate text-right tabular-nums"
              title={value}
            >
              {value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  );
}

/** The item's actions, each offered only to a person who may take it. */
export function MediaDetailsActions({
  media,
  onCopyUrl,
  onDownload,
  onMove,
  onDelete,
}: MediaDetailsActionHandlers & { media: Media }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onCopyUrl(media)}
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
        Copy URL
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onDownload(media)}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Download
      </Button>
      {onMove && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onMove(media)}
        >
          <FolderInput className="h-4 w-4" aria-hidden="true" />
          Move to…
        </Button>
      )}
      {onDelete && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("gap-1.5", MEDIA_DESTRUCTIVE_TEXT_CLASSES)}
          onClick={() => onDelete(media)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      )}
    </div>
  );
}
