"use client";

/**
 * useUploadQueue
 *
 * The one queue every media upload in the admin goes through: the library's
 * drop-anywhere and Upload button, and the media picker's drop area. Each file
 * becomes a row with its own state, at most {@link UPLOAD_CONCURRENCY} upload
 * at once, and the rest wait their turn, so a drop of any size is taken whole
 * and a large one doesn't compete with itself for the connection.
 *
 * A file refused before upload (too large, a type not allowed) gets a row with
 * its reason and is never sent. A file the server refuses or that fails in
 * transit gets its reason and can be retried, and neither stops the others.
 *
 * The rows are kept in a ref as well as in state so the scheduler reads the
 * rows as they are now, not as the render that started an upload saw them:
 * two uploads finishing in the same tick must not both start the same waiting
 * file.
 */

import * as React from "react";

import { useUploadMedia } from "@admin/hooks/queries/useMedia";
import type { Media, UploadProgress } from "@admin/types/media";

/**
 * How many files upload at once. Browsers open about six connections to one
 * host, and the admin's own requests need some of them while a large drop
 * runs; three keeps more than one file moving and leaves the rest free.
 */
const UPLOAD_CONCURRENCY = 3;

/**
 * One file in the queue: the shared upload progress shape, with an id the row
 * is updated by and the folder it was dropped into. The folder is fixed when
 * the file is added, so a retry lands where the person dropped it even after
 * they have moved on to another folder.
 */
export type UploadRow = UploadProgress & {
  id: string;
  folderId: string | null;
};

/** What a drop or a file choice hands the queue. */
export interface DroppedFiles {
  /** Files that passed the checks the admin can make before upload. */
  accepted: File[];
  /** Files refused before upload, each with the reason its row shows. */
  refused: Array<{ file: File; reason: string }>;
}

/** The queue's rows counted by outcome, derived from the rows themselves. */
export interface UploadCounts {
  /** Every row the tray lists. */
  total: number;
  waiting: number;
  uploading: number;
  uploaded: number;
  failed: number;
  refused: number;
}

export interface UploadQueue {
  rows: UploadRow[];
  counts: UploadCounts;
  /** True while any file is waiting or uploading. */
  isUploading: boolean;
  /** One line for the tray's heading and the live region. */
  summary: string;
  add: (files: DroppedFiles, folderId: string | null) => void;
  retry: (id: string) => void;
  /** Closes the tray: removes every row that has finished. */
  dismiss: () => void;
}

// Row ids for keys and targeted updates; a module counter keeps them unique
// across drops and across the queues on one page.
let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `upload-${rowSeq}`;
}

function isSettled(row: UploadRow): boolean {
  return row.status !== "pending" && row.status !== "uploading";
}

/** Counts the rows by outcome. */
function countUploads(rows: readonly UploadRow[]): UploadCounts {
  const counts: UploadCounts = {
    total: rows.length,
    waiting: 0,
    uploading: 0,
    uploaded: 0,
    failed: 0,
    refused: 0,
  };
  for (const row of rows) {
    if (row.status === "pending") counts.waiting += 1;
    else if (row.status === "uploading") counts.uploading += 1;
    else if (row.status === "success") counts.uploaded += 1;
    else if (row.status === "error") counts.failed += 1;
    else counts.refused += 1;
  }
  return counts;
}

/**
 * The queue in one line. While files move it counts the finished ones up
 * against the files that will be sent (a refused file never is); once
 * everything has finished it says how it went.
 */
function describeUploads(counts: UploadCounts): string {
  const sendable = counts.total - counts.refused;
  if (counts.waiting + counts.uploading > 0) {
    const finished = sendable - counts.waiting - counts.uploading;
    return `Uploading ${finished} of ${sendable}`;
  }
  return [
    `${counts.uploaded} uploaded`,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.refused > 0 ? `${counts.refused} refused` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function useUploadQueue(options?: {
  /**
   * Called each time the queue empties, with the files uploaded since it last
   * did, so a caller can act once per batch (the picker selects them).
   */
  onSettled?: (uploaded: Media[]) => void;
}): UploadQueue {
  const [rows, setRows] = React.useState<UploadRow[]>([]);
  const rowsRef = React.useRef<UploadRow[]>([]);
  // What uploaded since the queue last emptied, for `onSettled`.
  const uploadedRef = React.useRef<Media[]>([]);
  const onSettledRef = React.useRef(options?.onSettled);
  React.useEffect(() => {
    onSettledRef.current = options?.onSettled;
  });

  // The existing upload: progress through XMLHttpRequest, the session
  // refresh, and the media lists refreshed after each file.
  const { mutateAsync: uploadOne } = useUploadMedia();

  const commit = React.useCallback((next: UploadRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const patch = React.useCallback(
    (id: string, change: Partial<UploadRow>) => {
      commit(
        rowsRef.current.map(row =>
          row.id === id ? { ...row, ...change } : row
        )
      );
    },
    [commit]
  );

  // Starts waiting files while fewer than the limit are uploading, and calls
  // `onSettled` once nothing is left to send. Runs after every add, finish
  // and retry, which are the only moments a slot can open or fill.
  const pumpRef = React.useRef<() => void>(() => undefined);
  const pump = React.useCallback(() => {
    const current = rowsRef.current;
    const running = current.filter(row => row.status === "uploading").length;
    const next = current
      .filter(row => row.status === "pending")
      .slice(0, Math.max(0, UPLOAD_CONCURRENCY - running));

    for (const row of next) {
      patch(row.id, { status: "uploading", progress: 0 });
      uploadOne({
        file: row.file,
        folderId: row.folderId,
        onProgress: progress => patch(row.id, { progress }),
      })
        .then(media => {
          uploadedRef.current.push(media);
          patch(row.id, {
            status: "success",
            progress: 100,
            mediaId: media.id,
            error: undefined,
          });
        })
        .catch((error: unknown) => {
          patch(row.id, {
            status: "error",
            error:
              error instanceof Error && error.message
                ? error.message
                : "The upload failed.",
          });
        })
        .finally(() => pumpRef.current());
    }

    if (rowsRef.current.every(isSettled) && uploadedRef.current.length > 0) {
      const uploaded = uploadedRef.current;
      uploadedRef.current = [];
      onSettledRef.current?.(uploaded);
    }
  }, [patch, uploadOne]);
  React.useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const add = React.useCallback(
    (files: DroppedFiles, folderId: string | null) => {
      const queued: UploadRow[] = files.accepted.map(file => ({
        id: nextRowId(),
        file,
        filename: file.name,
        status: "pending",
        progress: 0,
        folderId,
      }));
      const refused: UploadRow[] = files.refused.map(({ file, reason }) => ({
        id: nextRowId(),
        file,
        filename: file.name,
        status: "rejected",
        error: reason,
        folderId,
      }));
      if (queued.length + refused.length === 0) return;
      // A drop onto a finished tray starts a fresh one; a drop while files
      // are still moving joins them.
      const kept = rowsRef.current.every(isSettled) ? [] : rowsRef.current;
      commit([...kept, ...queued, ...refused]);
      pump();
    },
    [commit, pump]
  );

  const retry = React.useCallback(
    (id: string) => {
      // Only a failure is retried: a refused file would be refused again.
      const row = rowsRef.current.find(r => r.id === id);
      if (row?.status !== "error") return;
      patch(id, { status: "pending", progress: 0, error: undefined });
      pump();
    },
    [patch, pump]
  );

  const dismiss = React.useCallback(() => {
    commit(rowsRef.current.filter(row => !isSettled(row)));
  }, [commit]);

  const counts = React.useMemo(() => countUploads(rows), [rows]);
  const isUploading = counts.waiting + counts.uploading > 0;

  return {
    rows,
    counts,
    isUploading,
    summary: describeUploads(counts),
    add,
    retry,
    dismiss,
  };
}
