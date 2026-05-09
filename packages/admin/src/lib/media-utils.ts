import type { MediaType } from "@admin/types/media";

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
