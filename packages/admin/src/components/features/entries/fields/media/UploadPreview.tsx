/**
 * Upload Preview Component
 *
 * Displays a preview card for uploaded files with thumbnail support for images
 * and color-coded file type icons for other file types.
 *
 * Features:
 * - Image thumbnails with dimensions display
 * - Color-coded file type icons (blue/purple/green/red)
 * - Clickable preview to open file in new tab
 * - Remove button on hover
 * - File info overlay (filename, size, dimensions)
 *
 * @module components/entries/fields/media/UploadPreview
 * @since 1.0.0
 */

import { Button, Card } from "@revnixhq/ui";

import {
  X,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  ExternalLink,
  Settings,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface UploadedFile {
  /**
   * Unique identifier for the upload.
   */
  id: string;

  /**
   * Original filename.
   */
  filename: string;

  /**
   * URL to access the uploaded file.
   */
  url?: string;

  /**
   * URL to thumbnail (for images).
   */
  thumbnailUrl?: string;

  /**
   * MIME type of the file.
   */
  mimeType?: string;

  /**
   * File size in bytes.
   */
  filesize?: number;

  /**
   * Image width in pixels (for images).
   */
  width?: number;

  /**
   * Image height in pixels (for images).
   */
  height?: number;
  /**
   * Alt text for accessibility.
   */
  altText?: string;
  /**
   * Title for the media.
   */
  title?: string;
  /**
   * Caption for the media.
   */
  caption?: string;
  /**
   * Tags for organization.
   */
  tags?: string[];
  /**
   * Folder ID the media belongs to.
   */
  folderId?: string | null;
}

export interface UploadPreviewProps {
  /**
   * The uploaded file to display.
   */
  file: UploadedFile;

  /**
   * Callback when remove button is clicked.
   */
  onRemove: () => void;
  /**
   * Callback when edit button is clicked.
   */
  onEdit?: () => void;

  /**
   * Whether the remove button should be disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Additional CSS classes.
   */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get appropriate icon with color based on MIME type.
 * Colors: blue (image), purple (video), green (audio), red (PDF), gray (other)
 */
function getFileIcon(mimeType?: string) {
  if (!mimeType) {
    return <File className="h-12 w-12 text-muted-foreground" />;
  }

  if (mimeType.startsWith("image/")) {
    return <FileImage className="h-12 w-12 text-primary" />;
  }
  if (mimeType.startsWith("video/")) {
    return <FileVideo className="h-12 w-12 text-purple-500" />;
  }
  if (mimeType.startsWith("audio/")) {
    return <FileAudio className="h-12 w-12 text-green-500" />;
  }
  if (
    mimeType === "application/pdf" ||
    mimeType.includes("document") ||
    mimeType.includes("text")
  ) {
    return <FileText className="h-12 w-12 text-red-500" />;
  }

  return <File className="h-12 w-12 text-muted-foreground" />;
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) return "";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Format image dimensions for display.
 */
function formatDimensions(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  return `${width} × ${height}`;
}

// ============================================================
// Component
// ============================================================

/**
 * UploadPreview displays a preview card for an uploaded file.
 *
 * Features:
 * - Image thumbnails for image files
 * - Color-coded file type icons for non-image files
 * - Filename display with truncation
 * - File size and dimensions display
 * - Remove button with hover reveal
 * - Clickable preview to open file in new tab
 *
 * @example
 * ```tsx
 * <UploadPreview
 *   file={{
 *     id: "123",
 *     filename: "photo.jpg",
 *     url: "/uploads/photo.jpg",
 *     thumbnailUrl: "/uploads/thumbnails/photo.jpg",
 *     mimeType: "image/jpeg",
 *     filesize: 1024000,
 *     width: 1920,
 *     height: 1080,
 *   }}
 *   onRemove={() => handleRemove("123")}
 * />
 * ```
 */
export function UploadPreview({
  file,
  onRemove,
  onEdit,
  disabled = false,
  className,
}: UploadPreviewProps) {
  const isImage = file.mimeType?.startsWith("image/");
  const thumbnailSrc = file.thumbnailUrl || (isImage ? file.url : undefined);
  const dimensions = formatDimensions(file.width, file.height);
  const fileSize = formatFileSize(file.filesize);

  /**
   * Handle click on the preview to open the file.
   */
  const handlePreviewClick = () => {
    if (file.url) {
      window.open(file.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Card className={cn("relative group overflow-hidden", className)}>
      {/* Preview area - clickable to open file */}
      <div
        className={cn(
          "aspect-square bg-primary/5 flex items-center justify-center",
          file.url && "cursor-pointer"
        )}
        onClick={handlePreviewClick}
        role={file.url ? "button" : undefined}
        tabIndex={file.url ? 0 : undefined}
        onKeyDown={e => {
          if (file.url && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            handlePreviewClick();
          }
        }}
        aria-label={file.url ? `Open ${file.filename} in new tab` : undefined}
      >
        {thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt={file.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 p-4">
            {getFileIcon(file.mimeType)}
            <span className="text-xs text-muted-foreground truncate max-w-full px-2 text-center">
              {file.filename}
            </span>
          </div>
        )}

        {/* External link indicator on hover (for files with URL) */}
        {file.url && (
          <div
            className={cn(
              "absolute inset-0 bg-black/40 flex items-center justify-center",
              "opacity-0 group-hover:opacity-100 transition-opacity",
              "pointer-events-none"
            )}
          >
            <ExternalLink className="h-8 w-8 text-white" />
          </div>
        )}
      </div>

      {/* Remove button - visible on hover */}
      {!disabled && (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className={cn(
            "absolute top-2 right-2 h-6 w-6",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "shadow-lg z-10"
          )}
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${file.filename}`}
        >
          <X className="h-3 w-3" />
        </Button>
      )}

      {/* Edit button - visible on hover */}
      {!disabled && onEdit && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={cn(
            "absolute top-2 right-10 h-6 w-6",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "shadow-lg z-10"
          )}
          onClick={e => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={`Edit settings for ${file.filename}`}
        >
          <Settings className="h-3 w-3" />
        </Button>
      )}

      {/* File info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 pointer-events-none">
        <p className="text-xs text-white truncate">{file.filename}</p>
        <div className="flex items-center gap-2 text-xs text-white/70">
          {fileSize && <span>{fileSize}</span>}
          {fileSize && dimensions && <span>•</span>}
          {dimensions && <span>{dimensions}</span>}
        </div>
      </div>
    </Card>
  );
}

// ============================================================
// Exports
// ============================================================
