"use client";

/**
 * UploadTray
 *
 * Lists every file in an upload queue: its name, a small preview, and its
 * progress, the reason it failed or was refused, or that it is done. A
 * failure offers Retry on its own row, and an uploaded image offers Add alt
 * text where the caller handles it. The heading counts the files through,
 * and the same line goes to a polite live region, which stays mounted while
 * the tray is closed so the first announcement of a new upload is heard too.
 *
 * In the library the tray floats over the page's corner, so it stays in view
 * while the person goes on browsing; in the media picker it sits inline under
 * the drop area, inside the dialog. It stays until the person closes it, even
 * once everything has uploaded, so the outcome can't vanish unread.
 *
 * The floating tray shares its corner with the admin's toasts, so while it is
 * open it lifts them above itself (see {@link useToastClearance}).
 *
 * The queue itself is {@link useUploadQueue}; this only draws it.
 */

import { Button, Progress, toast } from "@nextlyhq/ui";
import * as React from "react";

import { Check, RefreshCw, X } from "@admin/components/icons";
import { MEDIA_DESTRUCTIVE_TEXT_CLASSES } from "@admin/constants/media";
import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";
import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { formatFileSize } from "@admin/lib/media-utils";
import { retryableModule } from "@admin/lib/retryable-module";
import { cn } from "@admin/lib/utils";
import type { Media, MediaUpdateInput } from "@admin/types/media";

import type { MediaSave } from "../MediaDetails";

import type { UploadQueue, UploadRow } from "./useUploadQueue";

export interface UploadTrayProps {
  queue: UploadQueue;
  /** `floating` over the page's corner (the library), or `inline` (the picker). */
  placement: "floating" | "inline";
  /**
   * Where focus goes when Close takes the tray away, so it isn't dropped on
   * the page's body. The library passes its heading.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Saves an uploaded image's alt text. Given, each uploaded image's row
   * offers Add alt text, which opens the Edit dialog on that field: files
   * upload the moment they are chosen, so this is the first place alt text
   * can be written. Without it, no row offers the action.
   */
  onSaveMedia?: MediaSave;
  className?: string;
}

/**
 * While the floating tray is open, sets the toaster's bottom offset so toasts
 * sit just above the tray instead of over it: the tray's height, plus its own
 * 1rem from the window's edge and a 0.5rem gap. Followed as rows come and go,
 * and removed when the tray closes, which puts toasts back in their corner.
 */
function useToastClearance(
  trayRef: React.RefObject<HTMLElement | null>,
  active: boolean
): void {
  React.useEffect(() => {
    const tray = trayRef.current;
    if (!active || !tray) return;
    const root = document.documentElement;
    const clear = () =>
      root.style.setProperty(
        TOAST_OFFSET_BOTTOM_PROPERTY,
        `calc(${tray.offsetHeight}px + 1.5rem)`
      );
    clear();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(clear);
    observer?.observe(tray);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(TOAST_OFFSET_BOTTOM_PROPERTY);
    };
  }, [trayRef, active]);
}

/**
 * Whether the tray's list is taller than the box it scrolls in. A scrolling
 * region with nothing focusable inside it can't be scrolled from the keyboard,
 * so the list takes focus itself while, and only while, it scrolls: a list
 * that fits adds no tab stop. Measured again as rows come and go, and as the
 * window resizes the tray.
 */
function useListScrolls(
  listRef: React.RefObject<HTMLElement | null>,
  rowCount: number
): boolean {
  const [scrolls, setScrolls] = React.useState(false);
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setScrolls(list.scrollHeight > list.clientHeight);
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(list);
    return () => observer?.disconnect();
  }, [listRef, rowCount]);
  return scrolls;
}

/**
 * The file's own image while it uploads, read from the file on disk. Nothing
 * for a file that isn't an image, or where the browser can't make a URL for
 * it; the square stays so the rows line up.
 */
function UploadThumbnail({ file }: { file: File }): React.JSX.Element {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (
      !file.type.startsWith("image/") ||
      typeof URL.createObjectURL !== "function"
    ) {
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
    </div>
  );
}

/**
 * The Edit dialog opened from a row's Add alt text: which image it is open on,
 * and the save that keeps what was written.
 *
 * A row keeps its media as it uploaded, so what was saved since is laid over
 * it here. Without that, a second Add alt text on the same row would open on
 * an empty field again. Only the values sent are laid over: an empty field is
 * not sent, and the server keeps what it had.
 */
function useAltTextEditor(onSaveMedia: MediaSave | undefined): {
  media: Media | null;
  open: (media: Media) => void;
  close: () => void;
  save: (updates: MediaUpdateInput) => Promise<void>;
} {
  const [media, setMedia] = React.useState<Media | null>(null);
  const [saved, setSaved] = React.useState<Record<string, Media>>({});

  const open = React.useCallback(
    (uploaded: Media) => setMedia(saved[uploaded.id] ?? uploaded),
    [saved]
  );
  const close = React.useCallback(() => setMedia(null), []);
  const save = React.useCallback(
    async (updates: MediaUpdateInput) => {
      if (!media || !onSaveMedia) return;
      await onSaveMedia(media.id, updates);
      const sent = Object.fromEntries(
        Object.entries(updates).filter(([, value]) => value !== undefined)
      );
      setSaved(prev => ({ ...prev, [media.id]: { ...media, ...sent } }));
    },
    [media, onSaveMedia]
  );

  return { media, open, close, save };
}

/**
 * The Edit dialog's code, fetched the first time Add alt text is used. Drawn
 * into the tray directly it came in the tray's own chunk, which loads as the
 * library mounts, and took that chunk well past its size budget for a dialog
 * most visits never open.
 */
const editDialogModule = retryableModule(() =>
  import("../MediaEditDialog").then(m => m.MediaEditDialog)
);

/**
 * The Edit dialog on an uploaded image's alt text, once its code has arrived;
 * nothing while it is on its way. If the code could not be fetched it says so
 * and closes, and the next Add alt text fetches it again.
 */
function AltTextDialog({
  media,
  onClose,
  onSave,
}: {
  media: Media;
  onClose: () => void;
  onSave: (updates: MediaUpdateInput) => Promise<void>;
}): React.JSX.Element | null {
  const { state } = useRetryableModule(
    editDialogModule,
    "The edit dialog's code"
  );
  React.useEffect(() => {
    if (state.status !== "error") return;
    toast.error("Alt text can't be added right now", {
      description: "The edit dialog could not be loaded. Try again.",
    });
    onClose();
  }, [state.status, onClose]);
  if (state.status !== "ok") return null;
  const MediaEditDialog = state.value;
  return (
    <MediaEditDialog
      open
      media={media}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      onSave={onSave}
      focusAltText
    />
  );
}

/** What a row says under its name, by the state the file is in. */
function RowStatus({ row }: { row: UploadRow }): React.JSX.Element {
  switch (row.status) {
    case "uploading":
      return (
        <Progress
          value={row.progress ?? 0}
          className="mt-1.5 h-1"
          aria-label={`Uploading ${row.filename}: ${row.progress ?? 0}%`}
        />
      );
    case "success":
      return (
        <p className="flex items-center gap-1 text-xs text-success">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Done
        </p>
      );
    case "error":
    case "rejected":
      // The details' red: the base token reads under 4.5:1 on a light card.
      return (
        <p className={cn("text-xs", MEDIA_DESTRUCTIVE_TEXT_CLASSES)}>
          {row.error}
        </p>
      );
    default:
      return <p className="text-xs text-muted-foreground">Waiting</p>;
  }
}

function UploadTrayRow({
  row,
  onRetry,
  onAddAltText,
}: {
  row: UploadRow;
  onRetry: (id: string) => void;
  onAddAltText?: (media: Media) => void;
}): React.JSX.Element {
  // Alt text describes an image, so only an uploaded image offers it. The type
  // is read with care: a row is drawn from whatever the upload answered, and
  // a row the tray could not draw would hide every other file's progress.
  const altTextFor =
    onAddAltText &&
    row.status === "success" &&
    row.media?.mimeType?.startsWith("image/")
      ? row.media
      : undefined;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <UploadThumbnail file={row.file} />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          {/* Retry or a size can narrow the name until it is cut short;
              the whole name stays readable on hover. */}
          <p
            className="truncate text-sm font-medium text-foreground"
            title={row.filename}
          >
            {row.filename}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatFileSize(row.file.size)}
          </span>
        </div>
        <RowStatus row={row} />
      </div>
      <div className="flex min-w-10 justify-end">
        {row.status === "uploading" && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.progress ?? 0}%
          </span>
        )}
        {/* A failure retries the same file; a refused file would only be
            refused again, so it has no Retry. */}
        {row.status === "error" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRetry(row.id)}
            aria-label={`Retry ${row.filename}`}
            className="h-7 gap-1 px-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        )}
        {altTextFor && onAddAltText && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAddAltText(altTextFor)}
            aria-label={`Add alt text to ${row.filename}`}
            className="h-7 px-2"
          >
            Add alt text
          </Button>
        )}
      </div>
    </li>
  );
}

export function UploadTray({
  queue,
  placement,
  returnFocusRef,
  onSaveMedia,
  className,
}: UploadTrayProps): React.JSX.Element {
  const { rows, summary, isUploading } = queue;
  const altText = useAltTextEditor(onSaveMedia);
  const trayRef = React.useRef<HTMLElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  useToastClearance(trayRef, placement === "floating" && rows.length > 0);
  const listScrolls = useListScrolls(listRef, rows.length);

  // Close clears every row, since it is offered only once nothing is moving,
  // so the tray and the button go; focus moves on rather than being lost.
  const close = () => {
    queue.dismiss();
    returnFocusRef?.current?.focus();
  };

  // The uploads' live region is not drawn here: `LazyUploadTray` draws it
  // beside this tray, so it is mounted before this chunk has arrived.
  return (
    <>
      {rows.length > 0 && (
        <section
          ref={trayRef}
          aria-label="Uploads"
          className={cn(
            "flex flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground",
            placement === "floating" &&
              "fixed bottom-4 right-4 z-40 max-h-[min(22.5rem,60dvh)] w-[21.25rem] max-w-[calc(100vw-2rem)] shadow-lg",
            className
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <h2 className="mr-auto min-w-0 truncate text-sm font-semibold">
              {summary}
            </h2>
            {/* Closing while files still move would hide them; it clears the
                finished rows once everything has finished. A native button,
                so Tab reaches it and it shows the shared focus ring. */}
            {!isUploading && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={close}
                aria-label="Close uploads"
                title="Close uploads"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
          <ul
            ref={listRef}
            aria-label="Uploaded files"
            tabIndex={listScrolls ? 0 : undefined}
            className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {rows.map(row => (
              <UploadTrayRow
                key={row.id}
                row={row}
                onRetry={queue.retry}
                onAddAltText={onSaveMedia ? altText.open : undefined}
              />
            ))}
          </ul>
        </section>
      )}
      {onSaveMedia && altText.media && (
        <AltTextDialog
          media={altText.media}
          onClose={altText.close}
          onSave={altText.save}
        />
      )}
    </>
  );
}
