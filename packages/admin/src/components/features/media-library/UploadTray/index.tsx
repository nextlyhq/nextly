"use client";

/**
 * UploadTray
 *
 * Lists every file in an upload queue: its name, a small preview, and its
 * progress, the reason it failed or was refused, or that it is done. A
 * failure offers Retry on its own row. The heading counts the files through,
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

import { Button, Progress } from "@nextlyhq/ui";
import * as React from "react";

import { Check, RefreshCw, X } from "@admin/components/icons";
import { MEDIA_DESTRUCTIVE_TEXT_CLASSES } from "@admin/constants/media";
import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";
import { formatFileSize } from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";

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
}: {
  row: UploadRow;
  onRetry: (id: string) => void;
}): React.JSX.Element {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <UploadThumbnail file={row.file} />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">
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
      </div>
    </li>
  );
}

export function UploadTray({
  queue,
  placement,
  returnFocusRef,
  className,
}: UploadTrayProps): React.JSX.Element {
  const { rows, summary, isUploading } = queue;
  const trayRef = React.useRef<HTMLElement>(null);
  useToastClearance(trayRef, placement === "floating" && rows.length > 0);

  // Close clears every row, since it is offered only once nothing is moving,
  // so the tray and the button go; focus moves on rather than being lost.
  const close = () => {
    queue.dismiss();
    returnFocusRef?.current?.focus();
  };

  return (
    <>
      {/* The single live region for uploads: always mounted, and separate
          from the visible heading, so each change is announced once. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {rows.length > 0 &&
          (isUploading ? summary : `Upload finished. ${summary}.`)}
      </div>

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
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {rows.map(row => (
              <UploadTrayRow key={row.id} row={row} onRetry={queue.retry} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
