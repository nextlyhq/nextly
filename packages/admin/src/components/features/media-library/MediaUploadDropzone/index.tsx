"use client";

/**
 * MediaUploadDropzone Component
 *
 * Drag-and-drop upload area for the media library and the media picker.
 *
 * Upload feedback is a single per-file queue: every file in a drop gets a row
 * with its own progress, status, and (for failures) a persistent human-readable
 * reason. Files the client rejects (too large, wrong type, over the batch cap)
 * appear as rows in the same queue rather than a separate alert, so a batch
 * with one bad file still reads as "9 uploaded, 1 failed" instead of an
 * all-red error state.
 *
 * Batch cap: drops larger than {@link MAX_FILES} upload the first
 * {@link MAX_FILES} files and mark the rest as skipped. The cap is enforced in
 * `onDrop` instead of react-dropzone's `maxFiles`, because `maxFiles` rejects
 * the ENTIRE batch with `too-many-files` when exceeded - valid files included.
 *
 * The queue outlives the drop target: when `isCollapsed` is true only the drop
 * target hides, so a parent can collapse the zone the moment an upload starts
 * (via `onUploadStart`) while progress stays visible.
 *
 * ## Visual states (drop target)
 *
 * - Default: dashed `border-border`
 * - Drag active: `border-primary`
 * - Drag reject: `border-destructive` (live feedback while dragging only)
 * - Uploading: spinner + count (shown where the target stays open, e.g. the picker)
 *
 * **Supported file types** (default): PNG, JPG, JPEG, GIF, WebP, MP4, MOV, AVI, PDF
 * **File size limit**: 10MB per file by default (server default; overridable via `maxFileSize`)
 * **Batch cap**: 10 files per drop
 *
 * ## Accessibility
 *
 * - Keyboard: Tab to the target, Enter/Space to browse
 * - The browse hint is plain text inside the single `role="button"` target
 *   (no nested interactive elements)
 * - ARIA live region announces progress and results
 */

import { Progress, Button } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  useDropzone,
  type Accept,
  type FileRejection,
  type FileError,
} from "react-dropzone";

import {
  Upload,
  Loader2,
  AlertTriangle,
  X,
  Check,
  RefreshCw,
} from "@admin/components/icons";
import { useUploadMedia } from "@admin/hooks/queries/useMedia";
import { formatFileSize } from "@admin/lib/media-utils";
import { cn } from "@admin/lib/utils";
import type { Media, UploadProgress } from "@admin/types/media";

/**
 * MediaUploadDropzone component props
 */
export interface MediaUploadDropzoneProps {
  /**
   * Callback when upload completes successfully
   *
   * @param media - Array of uploaded Media objects
   */
  onUploadComplete?: (media: Media[]) => void;

  /**
   * Callback fired when at least one accepted file begins uploading.
   * Parents use this to auto-collapse the drop target; the queue stays
   * visible independently of `isCollapsed`.
   */
  onUploadStart?: () => void;

  /**
   * Controlled collapsed state. Hides the drop target only; an in-flight or
   * settled upload queue keeps rendering so results are never lost.
   *
   * @default undefined (uncontrolled, target visible)
   */
  isCollapsed?: boolean;

  /**
   * Callback when the close button is clicked
   */
  onToggleCollapse?: () => void;

  /**
   * MIME type filter pattern for allowed uploads (e.g., "image/*", "image/png,image/jpeg")
   *
   * @default undefined (accepts all file types defined in DEFAULT_ACCEPTED_FILE_TYPES)
   */
  accept?: string;

  /**
   * Maximum file size in bytes
   *
   * @default 10485760 (10MB, matching the server's default `limits.fileSize`)
   */
  maxFileSize?: number;

  /**
   * Optional CSS class name for custom styling
   */
  className?: string;

  /**
   * Active folder ID for folder-aware uploads
   */
  activeFolderId?: string | null;

  /**
   * Active folder name for display in the upload indicator
   */
  activeFolderName?: string | null;
}

/**
 * Default accepted file types for dropzone
 *
 * - Images: PNG, JPG, JPEG, GIF, WebP
 * - Videos: MP4, MOV, AVI
 * - Documents: PDF
 */
const DEFAULT_ACCEPTED_FILE_TYPES: Accept = {
  "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
  "video/*": [".mp4", ".mov", ".avi"],
  "application/pdf": [".pdf"],
};

/**
 * Default maximum file size. Matches the server's default `limits.fileSize`
 * (10MB) so the client pre-check and the server agree; the server stays
 * authoritative and its per-file errors render on the queue rows either way.
 */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

/**
 * Maximum number of files per drop. Enforced by slicing in `onDrop` (first
 * MAX_FILES upload, the rest are marked skipped) - see the header comment for
 * why react-dropzone's `maxFiles` is not used.
 */
const MAX_FILES = 10;

/**
 * How long an all-success queue stays visible before auto-dismissing.
 * Queues containing any failure persist until explicitly dismissed.
 */
const UPLOAD_SUCCESS_DISPLAY_DURATION_MS = 4000;

/**
 * Convert MIME type string to react-dropzone Accept format
 *
 * Supports formats like:
 * - "image/*" -> { "image/*": [] }
 * - "image/png,image/jpeg" -> { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] }
 * - "application/pdf" -> { "application/pdf": [".pdf"] }
 */
function parseAcceptString(acceptString?: string): Accept | undefined {
  if (!acceptString) return undefined;

  const accept: Accept = {};
  const types = acceptString.split(",").map(t => t.trim());

  for (const type of types) {
    if (type === "image/*") {
      accept["image/*"] = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
    } else if (type === "video/*") {
      accept["video/*"] = [".mp4", ".mov", ".avi"];
    } else if (type === "audio/*") {
      accept["audio/*"] = [".mp3", ".wav", ".ogg"];
    } else if (type === "application/pdf") {
      accept["application/pdf"] = [".pdf"];
    } else if (type.startsWith("image/")) {
      // Specific image types
      const subtype = type.split("/")[1];
      // Handle common aliases
      if (subtype === "jpeg") {
        accept[type] = [`.${subtype}`, ".jpg"];
      } else {
        accept[type] = [`.${subtype}`];
      }
    } else {
      // Generic MIME type
      accept[type] = [];
    }
  }

  return Object.keys(accept).length > 0 ? accept : undefined;
}

/**
 * Get human-readable file type description from accept string
 */
function getAcceptDescription(
  acceptString: string | undefined,
  maxSize: number
): string {
  const sizeLimit = ` up to ${formatFileSize(maxSize)}`;

  if (!acceptString) {
    return `PNG, JPG, GIF, WebP, MP4, MOV, PDF${sizeLimit}`;
  }

  const types: string[] = [];
  if (acceptString.includes("image/*")) {
    types.push("Images");
  } else if (acceptString.includes("image/")) {
    types.push("Images");
  }
  if (acceptString.includes("video/*")) {
    types.push("Videos");
  }
  if (acceptString.includes("audio/*")) {
    types.push("Audio");
  }
  if (acceptString.includes("application/pdf")) {
    types.push("PDF");
  }

  if (types.length === 0) {
    return `Files${sizeLimit}`;
  }

  return `${types.join(", ")}${sizeLimit}`;
}

/**
 * Map react-dropzone rejection codes to human-readable copy. Raw library
 * defaults leak byte counts ("File is larger than 5242880 bytes"), so every
 * known code gets explicit wording; unknown codes fall through to the
 * library's message rather than hiding it.
 */
export function describeFileError(error: FileError, maxSize: number): string {
  switch (error.code) {
    case "file-too-large":
      return `File is too large (max ${formatFileSize(maxSize)})`;
    case "file-invalid-type":
      return "File type is not supported";
    case "file-too-small":
      return "File is too small";
    case "too-many-files":
      return `Only ${MAX_FILES} files can be uploaded at once`;
    default:
      return error.message;
  }
}

/** Row reason for files beyond the batch cap. */
const BATCH_SKIP_MESSAGE = `Skipped: only ${MAX_FILES} files can be uploaded at once`;

/**
 * A queue row: upload progress plus a stable identity for updates/retry and
 * the folder the file was dropped into. The folder is snapshotted at drop
 * time so a retry lands in the folder the user originally targeted, even if
 * they navigated elsewhere while the failure sat in the queue.
 */
type UploadQueueItem = UploadProgress & {
  id: string;
  folderId: string | null;
};

// Stable row ids for React keys and targeted state updates; a module counter
// avoids collisions across drops without needing crypto APIs.
let queueItemSeq = 0;
function nextQueueItemId(): string {
  queueItemSeq += 1;
  return `upload-${queueItemSeq}`;
}

/**
 * Split a drop into uploadable rows and pre-failed rows (client rejections
 * and over-cap skips). Pure so the batch semantics are unit-testable.
 */
export function buildQueueFromDrop(
  acceptedFiles: File[],
  fileRejections: Pick<FileRejection, "file" | "errors">[],
  maxSize: number,
  folderId: string | null
): { toUpload: UploadQueueItem[]; failed: UploadQueueItem[] } {
  // The cap applies to VALID files: a batch with rejections still uploads up
  // to MAX_FILES valid files (rejected files never consume cap slots).
  const withinCap = acceptedFiles.slice(0, MAX_FILES);
  const overCap = acceptedFiles.slice(MAX_FILES);

  const toUpload: UploadQueueItem[] = withinCap.map(file => ({
    id: nextQueueItemId(),
    file,
    filename: file.name,
    status: "pending",
    progress: 0,
    folderId,
  }));

  const failed: UploadQueueItem[] = [
    ...fileRejections.map(({ file, errors }) => ({
      id: nextQueueItemId(),
      file,
      filename: file.name,
      status: "rejected" as const,
      error: errors.map(e => describeFileError(e, maxSize)).join(", "),
      folderId,
    })),
    ...overCap.map(file => ({
      id: nextQueueItemId(),
      file,
      filename: file.name,
      status: "rejected" as const,
      skipped: true,
      error: BATCH_SKIP_MESSAGE,
      folderId,
    })),
  ];

  return { toUpload, failed };
}

/**
 * MediaUploadDropzone component
 *
 * Drag-and-drop upload area with per-file validation, progress, retry, and
 * partial-success reporting.
 *
 * @param props - MediaUploadDropzone props
 * @returns MediaUploadDropzone component
 */
export function MediaUploadDropzone({
  onUploadComplete,
  onUploadStart,
  isCollapsed: controlledIsCollapsed,
  onToggleCollapse,
  accept,
  maxFileSize,
  className,
  activeFolderId,
  activeFolderName,
}: MediaUploadDropzoneProps) {
  // Collapsed state is fully controlled by parent; kept for backward-compat API
  const isCollapsed =
    controlledIsCollapsed !== undefined ? controlledIsCollapsed : false;

  // Parse accept string to react-dropzone format
  const acceptedFileTypes = React.useMemo(
    () => parseAcceptString(accept) || DEFAULT_ACCEPTED_FILE_TYPES,
    [accept]
  );

  // Use provided maxFileSize or default
  const maxSize = maxFileSize || DEFAULT_MAX_FILE_SIZE;

  // Get human-readable description
  const fileTypeDescription = React.useMemo(
    () => getAcceptDescription(accept, maxSize),
    [accept, maxSize]
  );

  // Upload queue state (uploadable rows and pre-failed rows together)
  const [uploadQueue, setUploadQueue] = React.useState<UploadQueueItem[]>([]);

  // Upload mutation (disable auto-invalidate for batch uploads)
  const { mutateAsync: uploadMediaAsync } = useUploadMedia({
    disableAutoInvalidate: true,
  });

  // Query client for manual cache invalidation after batch upload
  const queryClient = useQueryClient();

  // Upload a single queue row, updating only that row by id. Shared by the
  // initial batch and per-row retry; the destination is the row's own
  // drop-time folder, never the folder currently open in the UI.
  const uploadQueueItem = React.useCallback(
    (item: UploadQueueItem): Promise<Media | null> => {
      return uploadMediaAsync({
        file: item.file,
        folderId: item.folderId,
        onProgress: progress => {
          setUploadQueue(prevQueue =>
            prevQueue.map(row =>
              row.id === item.id
                ? { ...row, status: "uploading", progress }
                : row
            )
          );
        },
      })
        .then(media => {
          setUploadQueue(prevQueue =>
            prevQueue.map(row =>
              row.id === item.id
                ? {
                    ...row,
                    status: "success",
                    progress: 100,
                    mediaId: media.id,
                  }
                : row
            )
          );
          return media;
        })
        .catch((error: Error) => {
          setUploadQueue(prevQueue =>
            prevQueue.map(row =>
              row.id === item.id
                ? { ...row, status: "error", error: error.message }
                : row
            )
          );
          return null; // Return null for failed uploads
        });
    },
    [uploadMediaAsync]
  );

  // Handle file drop: build the queue (including pre-failed rows), then
  // upload the valid files in parallel.
  const handleDrop = React.useCallback(
    async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      const { toUpload, failed } = buildQueueFromDrop(
        acceptedFiles,
        fileRejections,
        maxSize,
        activeFolderId ?? null
      );

      // Starting a new drop replaces the previous batch's results
      setUploadQueue([...toUpload, ...failed]);

      if (toUpload.length === 0) return;

      // Collapse-on-start only fires when something actually uploads; an
      // all-rejected drop keeps the target open next to the failure rows.
      onUploadStart?.();

      const results = await Promise.all(toUpload.map(uploadQueueItem));
      const successfulUploads = results.filter(
        (media): media is Media => media !== null
      );

      // Invalidate media cache once after all uploads complete
      // This ensures the media list shows the newly uploaded files
      if (successfulUploads.length > 0) {
        await queryClient.invalidateQueries({ queryKey: ["media"] });

        // Call onUploadComplete callback after cache invalidation
        onUploadComplete?.(successfulUploads);
      }
    },
    [
      maxSize,
      activeFolderId,
      onUploadStart,
      uploadQueueItem,
      queryClient,
      onUploadComplete,
    ]
  );

  // Retry a server-failed row in place. Client-rejected rows never retry
  // (the file would just fail validation again).
  const handleRetry = React.useCallback(
    async (item: UploadQueueItem) => {
      setUploadQueue(prevQueue =>
        prevQueue.map(row =>
          row.id === item.id
            ? { ...row, status: "pending", progress: 0, error: undefined }
            : row
        )
      );

      const media = await uploadQueueItem(item);
      if (media) {
        await queryClient.invalidateQueries({ queryKey: ["media"] });
        onUploadComplete?.([media]);
      }
    },
    [uploadQueueItem, queryClient, onUploadComplete]
  );

  // react-dropzone hook
  // Use noClick: true and call open() explicitly to avoid bundling issues
  // where the implicit click-to-input mechanism breaks in compiled packages.
  //
  // Why the extra props: react-dropzone 14.3 declares its options as
  // `Pick<React.HTMLProps<HTMLElement>, "multiple" | "onDragEnter" |
  // "onDragOver" | "onDragLeave"> & {...}` and against the React 19
  // ambient types those four arrive as required. The hook still works
  // without user-side handlers — drag events are handled internally — so
  // we set `multiple: true` and pass through `undefined` for the drag
  // callbacks. Casting via `as DropzoneOptions` would hide the type
  // contract; explicit values keep the intent visible.
  //
  // No `maxFiles` here on purpose: the batch cap is handled in onDrop.
  const { getRootProps, getInputProps, isDragActive, isDragReject, open } =
    useDropzone({
      accept: acceptedFileTypes,
      maxSize: maxSize,
      multiple: true,
      disabled: uploadQueue.some(
        item => item.status === "uploading" || item.status === "pending"
      ),
      onDrop: (acceptedFiles, fileRejections) => {
        void handleDrop(acceptedFiles, fileRejections);
      },
      onDragEnter: undefined,
      onDragOver: undefined,
      onDragLeave: undefined,
      noClick: true,
      noKeyboard: true,
    });

  // Count items by status
  const pendingCount = uploadQueue.filter(
    item => item.status === "pending"
  ).length;
  const uploadingCount = uploadQueue.filter(
    item => item.status === "uploading"
  ).length;
  const successCount = uploadQueue.filter(
    item => item.status === "success"
  ).length;
  const skippedCount = uploadQueue.filter(
    item => item.status === "rejected" && item.skipped
  ).length;
  const failureCount =
    uploadQueue.filter(
      item => item.status === "error" || item.status === "rejected"
    ).length - skippedCount;

  // Check if currently uploading (any pending or actively uploading)
  const isUploading = pendingCount > 0 || uploadingCount > 0;

  // Count of files still in progress (pending + uploading)
  const inProgressCount = pendingCount + uploadingCount;

  // A settled all-success queue dismisses itself; any failure or skip keeps
  // the queue on screen until the user dismisses it, so errors are never lost.
  React.useEffect(() => {
    if (
      uploadQueue.length > 0 &&
      !isUploading &&
      failureCount === 0 &&
      skippedCount === 0
    ) {
      const timeoutId = setTimeout(() => {
        setUploadQueue([]);
      }, UPLOAD_SUCCESS_DISPLAY_DURATION_MS);

      return () => clearTimeout(timeoutId);
    }
  }, [uploadQueue.length, isUploading, failureCount, skippedCount]);

  // Drop-target visual state. Result states (success/error) live on the
  // queue rows, not the target, so partial success never paints the whole
  // zone red; `reject` is live drag feedback only.
  const getVisualState = () => {
    if (isDragReject) return "reject";
    if (isDragActive) return "active";
    if (isUploading) return "uploading";
    return "default";
  };

  const visualState = getVisualState();

  // Border styles — border-2 dashed, prominent, mode-aware
  const borderStyles = {
    // default: full-strength hover border, more visible than the resting border, not a fainter alpha.
    default: "border-2 border-dashed border-border hover:border-primary",
    active: "border-2 border-dashed border-primary",
    reject: "border-2 border-dashed border-destructive",
    uploading: "border-2 border-dashed border-primary/80",
  };

  // Background styles — use CSS variables (bg-card) so both light and dark modes resolve correctly.
  const backgroundStyles = {
    default: "bg-card",
    active: "bg-primary/5 dark:bg-primary/5",
    reject: "bg-destructive/5 dark:bg-destructive/10",
    uploading: "bg-card",
  };

  // Icon component based on state
  const IconComponent = {
    default: Upload,
    active: Upload,
    reject: AlertTriangle,
    uploading: Loader2,
  }[visualState];

  // Icon color based on state — default always uses primary for the circle contrast
  const iconColorStyles = {
    default: "text-primary",
    active: "text-primary",
    reject: "text-destructive",
    uploading: "text-primary",
  };

  // Queue summary copy: live count while uploading, outcome once settled.
  // Failures (validation/server errors) and batch-cap skips are reported
  // separately so a skipped file is never announced as a failed one.
  const settledSummary = [
    `${successCount} uploaded`,
    failureCount > 0 ? `${failureCount} failed` : null,
    skippedCount > 0 ? `${skippedCount} skipped` : null,
  ]
    .filter(Boolean)
    .join(", ");
  // The live denominator counts only rows that will actually upload;
  // pre-rejected rows sit in the same queue but were never attempted. The
  // numerator counts finished rows so the label climbs (0 -> N) instead of
  // counting down the remaining work.
  const uploadableCount = uploadQueue.filter(
    item => item.status !== "rejected"
  ).length;
  const finishedCount = uploadableCount - inProgressCount;
  const queueSummary = isUploading
    ? `Uploading files: ${finishedCount} of ${uploadableCount} done`
    : settledSummary;

  return (
    <div className={cn("w-full relative group/dropzone", className)}>
      {!isCollapsed && (
        <>
          {/* Close Button */}
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={e => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              className="absolute right-2 top-2 z-10 rounded-none bg-background/50 hover:bg-background/80 backdrop-blur-sm transition-colors"
              aria-label="Close upload zone"
            >
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* Dropzone */}
          <div
            {...getRootProps()}
            onClick={isUploading ? undefined : open}
            onKeyDown={e => {
              if (!isUploading && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                open();
              }
            }}
            className={cn(
              "relative flex flex-col items-center justify-center rounded-none transition-all duration-200 group",
              borderStyles[visualState],
              backgroundStyles[visualState],
              "min-h-48 md:min-h-56 py-16 px-8",
              !isUploading &&
                "cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2",
              isUploading && "cursor-not-allowed"
            )}
            role="button"
            aria-label="Upload files. Drag and drop files here, or press Enter to browse."
            aria-describedby="upload-instructions"
            tabIndex={isUploading ? -1 : 0}
          >
            <input {...getInputProps()} aria-hidden="true" tabIndex={-1} />

            {/* Icon circle — solid filled, primary light color background */}
            <div
              className={cn(
                "flex items-center justify-center rounded-none mb-5 transition-all duration-200",
                "w-16 h-16",
                // Solid filled square — no ring/outline, just a clean bg fill
                visualState === "default" &&
                  "bg-primary/20 dark:bg-primary/30 group-hover:bg-primary/30 dark:group-hover:bg-primary/40",
                visualState === "active" && "bg-primary/20 dark:bg-primary/25",
                visualState === "uploading" &&
                  "bg-primary/15 dark:bg-primary/20",
                visualState === "reject" &&
                  "bg-destructive/15 dark:bg-destructive/20"
              )}
            >
              <IconComponent
                className={cn(
                  iconColorStyles[visualState],
                  "h-7 w-7 transition-colors duration-200",
                  isUploading && "animate-spin"
                )}
              />
            </div>

            {/* Text content */}
            <div className="flex flex-col items-center gap-0.5 text-center">
              {/* Folder indicator */}
              {activeFolderId && activeFolderName && (
                <p className="mb-1 text-xs text-muted-foreground">
                  Uploading to:{" "}
                  <span className="font-medium">{activeFolderName}</span>
                </p>
              )}
              {/* Primary message. The browse hint is plain text: the whole
                  target is the interactive element, and a nested <button>
                  inside role="button" is invalid markup. */}
              {visualState === "default" && (
                <>
                  <p className="text-sm font-semibold text-foreground">
                    Drag &amp; drop files here
                  </p>
                  <span className="mt-1 text-sm font-medium text-primary underline underline-offset-2">
                    or click to browse
                  </span>
                </>
              )}
              {visualState !== "default" && (
                <p className="text-sm font-semibold text-foreground">
                  {visualState === "active" && "Drop files here..."}
                  {visualState === "reject" &&
                    "Some of these files can't be uploaded here"}
                  {visualState === "uploading" &&
                    `Uploading ${inProgressCount} file(s)...`}
                </p>
              )}

              {/* File type hint */}
              <p
                id="upload-instructions"
                className="mt-2 text-xs text-muted-foreground dark:text-muted-foreground/80"
              >
                {fileTypeDescription}
              </p>
            </div>

            {/* Screen reader-only instructions */}
            <span className="sr-only">
              {fileTypeDescription}. Maximum files: {MAX_FILES} files per
              upload.
            </span>
          </div>
        </>
      )}

      {/* The single ARIA live region for upload status. Always mounted so
          screen readers announce the first status too; the visible summary
          below is deliberately NOT a live region, so each state change is
          announced exactly once. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {uploadQueue.length > 0 &&
          (isUploading ? queueSummary : `Upload finished. ${settledSummary}.`)}
      </div>

      {/* Upload queue: renders regardless of isCollapsed so progress and
          failures stay visible after the drop target auto-collapses. */}
      {uploadQueue.length > 0 && (
        <div
          className={cn(
            "border border-border bg-card",
            isCollapsed ? "mt-0" : "mt-4"
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="text-sm font-medium text-foreground">
              {queueSummary}
            </p>
            {!isUploading && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUploadQueue([])}
                className="rounded-none"
              >
                Dismiss
              </Button>
            )}
          </div>

          <div className="space-y-3 px-4 py-3">
            {uploadQueue.map(item => (
              <div key={item.id} className="flex items-center gap-3">
                {/* Status icon */}
                <div className="shrink-0">
                  {item.status === "uploading" && (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  )}
                  {item.status === "success" && (
                    <Check className="h-4 w-4 text-success" />
                  )}
                  {(item.status === "error" || item.status === "rejected") && (
                    <X className="h-4 w-4 text-destructive" />
                  )}
                  {item.status === "pending" && (
                    <div className="h-4 w-4 rounded-none border-2 border-border" />
                  )}
                </div>

                {/* File info and progress */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.filename}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatFileSize(item.file.size)}
                    </span>
                  </div>

                  {/* Progress bar */}
                  {(item.status === "uploading" ||
                    item.status === "pending") && (
                    <Progress
                      value={item.progress || 0}
                      variant="default"
                      className="mt-1"
                      aria-label={`Uploading ${item.filename}: ${item.progress || 0}%`}
                    />
                  )}

                  {/* Failure reason */}
                  {(item.status === "error" || item.status === "rejected") &&
                    item.error && (
                      <p className="mt-1 text-xs text-destructive">
                        {item.error}
                      </p>
                    )}
                </div>

                {/* Retry applies to server failures only; a client-rejected
                    file would fail the same validation again. */}
                {item.status === "error" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRetry(item)}
                    className="rounded-none shrink-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
