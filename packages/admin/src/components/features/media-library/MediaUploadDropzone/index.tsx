"use client";

/**
 * MediaUploadDropzone Component
 *
 * Drag-and-drop file upload area with react-dropzone for media library.
 * Supports multi-file upload with progress tracking, file validation, and error handling.
 *
 * ## Design Specifications
 *
 * **Desktop Size**:
 * - Height: 256px (h-64) expanded, 64px (h-16) collapsed
 * - Width: Full width (w-full)
 *
 * **Mobile Size**:
 * - Height: 176px (h-44) expanded, 64px (h-16) collapsed
 * - Width: Full width (w-full)
 *
 * **Visual States**:
 * - Default: Dashed border (border-2 border-dashed border-border)
 * - Hover: Primary border (border-primary-300 bg-accent/50)
 * - Active (dragging): Primary border (border-primary-500 bg-primary-50)
 * - Uploading: Progress bars for each file
 * - Error: Red border (border-destructive bg-destructive/10)
 * - Collapsed: Compact 64px height with small icon
 *
 * **Supported File Types**:
 * - Images: PNG, JPG, JPEG, GIF, WebP
 * - Videos: MP4, MOV, AVI
 * - Documents: PDF
 *
 * **File Size Limit**: 5MB per file
 * **Max Files**: 10 files per upload
 *
 * ## Accessibility
 *
 * - WCAG 2.2 AA compliant
 * - Keyboard navigation (Tab, Enter, Space)
 * - Screen reader support (ARIA labels, live regions)
 * - Focus indicators (ring-2 ring-primary-500)
 * - Touch targets: 44×44px minimum on mobile
 *
 * ## Usage Examples
 *
 * ### Basic usage
 * ```tsx
 * <MediaUploadDropzone
 *   onUploadComplete={(media) => {
 *     console.log('Uploaded:', media);
 *   }}
 * />
 * ```
 *
 * ### Controlled collapsed state
 * ```tsx
 * const [isCollapsed, setIsCollapsed] = useState(false);
 *
 * <MediaUploadDropzone
 *   isCollapsed={isCollapsed}
 *   onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
 * />
 * ```
 *
 */

import { Alert, AlertDescription, Progress, Button } from "@revnixhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useDropzone, type Accept } from "react-dropzone";

import {
  Upload,
  Loader2,
  AlertTriangle,
  X,
  Check,
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
   *
   * @example
   * ```tsx
   * <MediaUploadDropzone
   *   onUploadComplete={(media) => {
   *     console.log(`Uploaded ${media.length} files`);
   *     toast.success(`${media.length} files uploaded`);
   *   }}
   * />
   * ```
   */
  onUploadComplete?: (media: Media[]) => void;

  /**
   * Controlled collapsed state
   *
   * @default undefined (uncontrolled)
   */
  isCollapsed?: boolean;

  /**
   * Callback when collapse button is clicked
   *
   * @example
   * ```tsx
   * const [isCollapsed, setIsCollapsed] = useState(false);
   *
   * <MediaUploadDropzone
   *   isCollapsed={isCollapsed}
   *   onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
   * />
   * ```
   */
  onToggleCollapse?: () => void;

  /**
   * MIME type filter pattern for allowed uploads (e.g., "image/*", "image/png,image/jpeg")
   *
   * @default undefined (accepts all file types defined in ACCEPTED_FILE_TYPES)
   */
  accept?: string;

  /**
   * Maximum file size in bytes
   *
   * @default 5242880 (5MB)
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
 * Default maximum file size (5MB)
 */
const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes

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
function getAcceptDescription(acceptString?: string, maxSize?: number): string {
  const sizeLimit = maxSize
    ? ` up to ${formatFileSize(maxSize)}`
    : " up to 5MB";

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
 * Maximum number of files per upload
 */
const MAX_FILES = 10;

/**
 * Duration to display upload success/error state before clearing queue (milliseconds)
 */
const UPLOAD_SUCCESS_DISPLAY_DURATION_MS = 2000;

/**
 * MediaUploadDropzone component
 *
 * Drag-and-drop upload area with file validation, progress tracking, and error handling.
 *
 * @param props - MediaUploadDropzone props
 * @returns MediaUploadDropzone component
 */
export function MediaUploadDropzone({
  onUploadComplete,
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
    () => getAcceptDescription(accept, maxFileSize),
    [accept, maxFileSize]
  );

  // Upload queue state
  const [uploadQueue, setUploadQueue] = React.useState<UploadProgress[]>([]);

  // Upload mutation (disable auto-invalidate for batch uploads)
  const { mutateAsync: uploadMediaAsync } = useUploadMedia({
    disableAutoInvalidate: true,
  });

  // Query client for manual cache invalidation after batch upload
  const queryClient = useQueryClient();

  // Handle file drop
  const handleDrop = React.useCallback(
    async (acceptedFiles: File[]) => {
      // Initialize upload queue
      const initialQueue: UploadProgress[] = acceptedFiles.map(file => ({
        file,
        filename: file.name,
        status: "pending",
        progress: 0,
      }));

      setUploadQueue(initialQueue);

      // Upload files in parallel
      const uploadPromises = acceptedFiles.map((file, index) => {
        return uploadMediaAsync({
          file,
          folderId: activeFolderId,
          onProgress: progress => {
            // Update progress for this file
            setUploadQueue(prevQueue =>
              prevQueue.map((item, i) =>
                i === index ? { ...item, status: "uploading", progress } : item
              )
            );
          },
        })
          .then(media => {
            // Mark as success
            setUploadQueue(prevQueue =>
              prevQueue.map((item, i) =>
                i === index
                  ? {
                      ...item,
                      status: "success",
                      progress: 100,
                      mediaId: media.id,
                    }
                  : item
              )
            );
            return media;
          })
          .catch(error => {
            // Mark as error
            setUploadQueue(prevQueue =>
              prevQueue.map((item, i) =>
                i === index
                  ? {
                      ...item,
                      status: "error",
                      error: error.message,
                    }
                  : item
              )
            );
            return null; // Return null for failed uploads
          });
      });

      // Wait for all uploads to complete
      const results = await Promise.all(uploadPromises);
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

      // Note: Queue will be cleared by useEffect after display duration
    },
    [uploadMediaAsync, queryClient, onUploadComplete, activeFolderId]
  );

  // react-dropzone hook
  // Use noClick: true and call open() explicitly to avoid bundling issues
  // where the implicit click-to-input mechanism breaks in compiled packages
  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject,
    fileRejections,
    open,
  } = useDropzone({
    accept: acceptedFileTypes,
    maxSize: maxSize,
    maxFiles: MAX_FILES,
    disabled: uploadQueue.some(item => item.status === "uploading"),
    onDrop: handleDrop,
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
  const errorCount = uploadQueue.filter(item => item.status === "error").length;

  // Check if currently uploading (any pending or actively uploading)
  const isUploading = pendingCount > 0 || uploadingCount > 0;

  // Count of files still in progress (pending + uploading)
  const inProgressCount = pendingCount + uploadingCount;

  // Clear upload queue after success/error display duration
  // This effect prevents memory leaks by cleaning up the timeout on unmount
  React.useEffect(() => {
    if (
      uploadQueue.length > 0 &&
      !isUploading &&
      (successCount > 0 || errorCount > 0)
    ) {
      const timeoutId = setTimeout(() => {
        setUploadQueue([]);
      }, UPLOAD_SUCCESS_DISPLAY_DURATION_MS);

      return () => clearTimeout(timeoutId);
    }
  }, [uploadQueue.length, isUploading, successCount, errorCount]);

  // Determine visual state
  const getVisualState = () => {
    if (isDragReject) return "reject";
    if (isDragActive) return "active";
    if (isUploading) return "uploading";
    if (errorCount > 0) return "error";
    if (successCount > 0) return "success";
    return "default";
  };

  const visualState = getVisualState();

  // Border styles — border-2 dashed, prominent, mode-aware
  const borderStyles = {
    default:
      "border-2 border-dashed border-border hover:border-primary/50 dark:border-muted-foreground/40 dark:hover:border-primary/60",
    active: "border-2 border-dashed border-primary",
    reject: "border-2 border-dashed border-destructive",
    uploading: "border-2 border-dashed border-primary/80",
    error: "border-2 border-dashed border-destructive",
    success: "border-2 border-dashed border-green-500 dark:border-green-400",
  };

  // Background styles — use CSS variables (bg-card) so both light and dark modes resolve correctly.
  // Avoid bg-white: it's a fixed color that wins over dark:bg-card due to Tailwind specificity.
  const backgroundStyles = {
    default: "bg-card",
    active: "bg-primary/5 dark:bg-primary/10",
    reject: "bg-destructive/5 dark:bg-destructive/10",
    uploading: "bg-card",
    error: "bg-destructive/5 dark:bg-destructive/10",
    success: "bg-green-500/5 dark:bg-green-500/10",
  };

  // Icon component based on state
  const IconComponent = {
    default: Upload,
    active: Upload,
    reject: AlertTriangle,
    uploading: Loader2,
    error: AlertTriangle,
    success: Check,
  }[visualState];

  // Icon color based on state — default always uses primary for the circle contrast
  const iconColorStyles = {
    default: "text-primary",
    active: "text-primary",
    reject: "text-destructive",
    uploading: "text-primary",
    error: "text-destructive",
    success: "text-green-500 dark:text-green-400",
  };

  if (isCollapsed) return null;

  return (
    <div className={cn("w-full relative group/dropzone", className)}>
      {/* Close Button */}
      {onToggleCollapse && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={e => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="absolute right-2 top-2 z-10 rounded-full bg-background/50 hover:bg-background/80 backdrop-blur-sm transition-colors"
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
          "relative flex flex-col items-center justify-center rounded-xl transition-all duration-200 group",
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
        <input {...getInputProps()} aria-hidden="true" />

        {/* Icon circle — solid filled, primary light color background */}
        <div
          className={cn(
            "flex items-center justify-center rounded-full mb-5 transition-all duration-200",
            "w-16 h-16",
            // Solid filled circle — no ring/outline, just a clean bg fill
            visualState === "default" &&
              "bg-primary/20 dark:bg-primary/30 group-hover:bg-primary/30 dark:group-hover:bg-primary/40",
            visualState === "active" && "bg-primary/20 dark:bg-primary/25",
            visualState === "uploading" && "bg-primary/15 dark:bg-primary/20",
            (visualState === "reject" || visualState === "error") &&
              "bg-destructive/15 dark:bg-destructive/20",
            visualState === "success" && "bg-green-500/15 dark:bg-green-500/20"
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
          {/* Primary message */}
          {visualState === "default" && (
            <>
              <p className="text-sm font-semibold text-foreground">
                Drag &amp; drop files here
              </p>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  open();
                }}
                className="mt-1 text-sm font-medium text-primary hover-unified underline underline-offset-2"
              >
                or click to browse
              </button>
            </>
          )}
          {visualState !== "default" && (
            <p className="text-sm font-semibold text-foreground">
              {visualState === "active" && "Drop files here..."}
              {visualState === "uploading" &&
                `Uploading ${inProgressCount} file(s)...`}
              {visualState === "success" &&
                `${successCount} file(s) uploaded successfully`}
              {(visualState === "error" || visualState === "reject") &&
                (errorCount > 0
                  ? `${errorCount} file(s) failed`
                  : "Invalid file type or size")}
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
          {fileTypeDescription}. Maximum files: {MAX_FILES} files per upload.
        </span>
      </div>

      {/* ARIA live region for upload status */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {isUploading && `Uploading ${inProgressCount} files...`}
        {successCount > 0 &&
          !isUploading &&
          `Upload complete. ${successCount} files uploaded successfully.`}
        {errorCount > 0 &&
          !isUploading &&
          `Upload failed. ${errorCount} files failed to upload.`}
      </div>

      {/* Upload progress */}
      {uploadQueue.length > 0 && !isCollapsed && (
        <div className="mt-4 space-y-3">
          {uploadQueue.map((item, index) => (
            <div key={index} className="flex items-center gap-3">
              {/* Status icon */}
              <div className="flex-shrink-0">
                {item.status === "uploading" && (
                  <Loader2 className="h-4 w-4 animate-spin text-primary-500" />
                )}
                {item.status === "success" && (
                  <Check className="h-4 w-4 text-green-500" />
                )}
                {item.status === "error" && (
                  <X className="h-4 w-4 text-destructive" />
                )}
                {item.status === "pending" && (
                  <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />
                )}
              </div>

              {/* File info and progress */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.filename}
                  </p>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(item.file.size)}
                  </span>
                </div>

                {/* Progress bar */}
                {(item.status === "uploading" || item.status === "pending") && (
                  <Progress
                    value={item.progress || 0}
                    variant="default"
                    className="mt-1"
                    aria-label={`Uploading ${item.filename}: ${item.progress || 0}%`}
                  />
                )}

                {/* Error message */}
                {item.status === "error" && item.error && (
                  <p className="mt-1 text-xs text-destructive">{item.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File rejection errors */}
      {fileRejections.length > 0 && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Some files were rejected:</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {fileRejections.map(({ file, errors }) => (
                <li key={file.name}>
                  <span className="font-medium">{file.name}</span>:{" "}
                  {errors.map(e => e.message).join(", ")}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
