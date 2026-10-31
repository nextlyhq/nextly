"use client";

/**
 * MediaUploadDropzone Component
 *
 * The media picker's drop area: drop files on it, or press it to choose them.
 * What is dropped goes to the shared upload queue and is listed in the upload
 * tray under the area, each file with its progress, the reason it failed or
 * was refused, and Retry for a failure. The library itself takes drops on its
 * whole page instead, through the same hook, queue and tray.
 *
 * Any number of files is taken, three upload at once and the rest wait.
 * Files refused before upload (too large, a type not allowed) are rows in the
 * same tray rather than a separate alert, so a batch with one bad file reads
 * as "9 uploaded, 1 refused".
 *
 * The tray outlives the drop target: when `isCollapsed` is true only the
 * target hides, so a parent can collapse it the moment an upload starts (via
 * `onUploadStart`) while the tray stays.
 *
 * ## Visual states (drop target)
 *
 * - Default: dashed `border-border`
 * - Drag active: `border-primary`
 * - Drag reject: `border-destructive` (live feedback while dragging only)
 *
 * The types and size it takes are in `./upload-limits`.
 *
 * ## Accessibility
 *
 * - Keyboard: Tab to the target, Enter/Space to browse
 * - The browse hint is plain text inside the single `role="button"` target
 *   (no nested interactive elements)
 * - The tray's live region announces progress and results
 */

import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { Upload, AlertTriangle, X } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";
import type { Media } from "@admin/types/media";

import { UploadTray } from "../UploadTray";
import { useUploadQueue } from "../UploadTray/useUploadQueue";

import { useMediaFileDrop } from "./useMediaFileDrop";

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
  isCollapsed = false,
  onToggleCollapse,
  accept,
  maxFileSize,
  className,
  activeFolderId,
  activeFolderName,
}: MediaUploadDropzoneProps): React.JSX.Element {
  // Each time the queue empties, the files it uploaded, in one call.
  const queue = useUploadQueue({ onSettled: onUploadComplete });

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject,
    open,
    description,
  } = useMediaFileDrop({
    accept,
    maxFileSize,
    onFiles: files => {
      queue.add(files, activeFolderId ?? null);
      // Collapse-on-start fires only when something will upload; an
      // all-refused drop keeps the target open beside its rows.
      if (files.accepted.length > 0) onUploadStart?.();
    },
  });

  // Drop-target visual state. Results live on the tray's rows, not the
  // target, so a partial success never paints the whole area red; `reject`
  // is live drag feedback only.
  const visualState = isDragReject
    ? "reject"
    : isDragActive
      ? "active"
      : "default";

  const borderStyles = {
    // default: full-strength hover border, more visible than the resting border, not a fainter alpha.
    default: "border-2 border-dashed border-border hover:border-primary",
    active: "border-2 border-dashed border-primary",
    reject: "border-2 border-dashed border-destructive",
  };

  // Background styles — use CSS variables (bg-card) so both light and dark modes resolve correctly.
  const backgroundStyles = {
    default: "bg-card",
    active: "bg-primary/5 dark:bg-primary/5",
    reject: "bg-destructive/5 dark:bg-destructive/10",
  };

  const IconComponent = visualState === "reject" ? AlertTriangle : Upload;

  return (
    <div className={cn("w-full relative group/dropzone", className)}>
      {!isCollapsed && (
        <>
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={e => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              className="absolute right-2 top-2 z-10 rounded-md bg-background/50 hover:bg-background/80 backdrop-blur-sm transition-colors"
              aria-label="Close upload zone"
            >
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* The target. Files can be added while others upload: they join
              the queue. */}
          <div
            {...getRootProps()}
            onClick={open}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }}
            className={cn(
              "relative flex flex-col items-center justify-center rounded-md transition-all duration-200 group",
              borderStyles[visualState],
              backgroundStyles[visualState],
              "min-h-48 md:min-h-56 py-16 px-8",
              "cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            )}
            role="button"
            aria-label="Upload files. Drag and drop files here, or press Enter to browse."
            aria-describedby="upload-instructions"
            tabIndex={0}
          >
            <input {...getInputProps()} aria-hidden="true" tabIndex={-1} />

            {/* Icon square — solid filled, primary light color background */}
            <div
              className={cn(
                "flex items-center justify-center rounded-md mb-5 transition-all duration-200",
                "w-16 h-16",
                visualState === "default" &&
                  "bg-primary/20 dark:bg-primary/30 group-hover:bg-primary/30 dark:group-hover:bg-primary/40",
                visualState === "active" && "bg-primary/20 dark:bg-primary/25",
                visualState === "reject" &&
                  "bg-destructive/15 dark:bg-destructive/20"
              )}
            >
              <IconComponent
                className={cn(
                  visualState === "reject"
                    ? "text-destructive"
                    : "text-primary",
                  "h-7 w-7 transition-colors duration-200"
                )}
              />
            </div>

            <div className="flex flex-col items-center gap-0.5 text-center">
              {activeFolderId && activeFolderName && (
                <p className="mb-1 text-xs text-muted-foreground">
                  Uploading to:{" "}
                  <span className="font-medium">{activeFolderName}</span>
                </p>
              )}
              {/* Primary message. The browse hint is plain text: the whole
                  target is the interactive element, and a nested <button>
                  inside role="button" is invalid markup. */}
              {visualState === "default" ? (
                <>
                  <p className="text-sm font-semibold text-foreground">
                    Drag &amp; drop files here
                  </p>
                  <span className="mt-1 text-sm font-medium text-primary underline underline-offset-2">
                    or click to browse
                  </span>
                </>
              ) : (
                <p className="text-sm font-semibold text-foreground">
                  {visualState === "active"
                    ? "Drop files here..."
                    : "Some of these files can't be uploaded here"}
                </p>
              )}

              {/* The types and size it takes, stated before upload. */}
              <p
                id="upload-instructions"
                className="mt-2 text-xs text-muted-foreground"
              >
                {description}
              </p>
            </div>
          </div>
        </>
      )}

      {/* The tray renders whether or not the target is collapsed, so
          progress and failures stay in view after it closes. */}
      <UploadTray
        queue={queue}
        placement="inline"
        className={isCollapsed ? undefined : "mt-4"}
      />
    </div>
  );
}
