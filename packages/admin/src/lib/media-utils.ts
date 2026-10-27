import type { Media, MediaType } from "@admin/types/media";

/**
 * Determine media type from MIME type.
 *
 * @param mimeType - MIME type string (e.g., "image/png"), or null/undefined
 * @returns MediaType enum value
 */
export function getMediaType(mimeType: string | null | undefined): MediaType {
  if (!mimeType || mimeType.trim() === "") return "other";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("application/vnd.") ||
    mimeType.startsWith("application/msword") ||
    mimeType.startsWith("text/")
  ) {
    return "document";
  }
  return "other";
}

/**
 * Format a file size in bytes to a human-readable string.
 *
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "2.4 MB")
 */
export function formatFileSize(bytes: number): string {
  // Handle edge cases
  if (!Number.isFinite(bytes) || bytes < 0) return "Invalid size";
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Get Badge variant for a media type.
 *
 * @param type - Media type
 * @returns Badge variant name
 */
export function getMediaTypeBadgeVariant(
  type: MediaType
): "success" | "primary" | "default" | "warning" {
  switch (type) {
    case "image":
      return "success";
    case "video":
      return "primary";
    case "document":
      return "default";
    case "audio":
      return "warning";
    default:
      return "default";
  }
}

/**
 * A media URL as the library copies it: absolute, so it still works pasted
 * into an email or another application. Local storage serves a path
 * (`/uploads/...`), which is made absolute on the page's own origin, where
 * the admin is serving that path; a cloud storage URL is already absolute.
 */
export function copyableMediaUrl(url: string): string {
  return new URL(url, window.location.origin).href;
}

/**
 * Where to draw an item's whole image from.
 *
 * The stored thumbnail is a square cut from the middle of the image, so it
 * shows the whole picture only when the picture is square. Anything else is
 * drawn from the file itself, which a tile then fits inside its frame. Unknown
 * dimensions count as not square: a crop shown as the whole image is the
 * mistake this exists to prevent, and a larger download is the safe side.
 */
export function wholeImageSrc(
  media: Pick<Media, "url" | "thumbnailUrl" | "width" | "height">
): string {
  const square =
    typeof media.width === "number" &&
    media.width > 0 &&
    media.width === media.height;
  return square && media.thumbnailUrl ? media.thumbnailUrl : media.url;
}

/**
 * The day an item was uploaded, as the library shows it in the list's column
 * and in the details panel. One formatter, so the two never disagree.
 */
export function formatUploadedDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
