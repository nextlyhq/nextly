"use client";

/**
 * The single live region that announces uploads.
 *
 * Its own module, drawn by {@link LazyUploadTray} beside the tray rather than
 * inside it: the tray's code arrives in a chunk of its own, and a screen reader
 * does not reliably announce what a live region already holds when the region
 * first appears. Drawn here, the region is in place from the moment the
 * library or drop area mounts, so a file chosen before the tray's code has
 * arrived is still announced as it moves and when it finishes.
 *
 * @module components/features/media-library/UploadTray/UploadLiveRegion
 */

import type { JSX } from "react";

import type { UploadQueue } from "./useUploadQueue";

/** Says the queue's summary while files move, and that they finished once they have. */
export function UploadLiveRegion({
  queue,
}: {
  queue: Pick<UploadQueue, "rows" | "summary" | "isUploading">;
}): JSX.Element {
  const { rows, summary, isUploading } = queue;
  return (
    // Separate from the tray's visible heading, so each change is announced once.
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {rows.length > 0 &&
        (isUploading ? summary : `Upload finished. ${summary}.`)}
    </div>
  );
}
