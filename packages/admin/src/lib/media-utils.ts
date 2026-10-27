import type { ImageSizeVariant, MediaType } from "@admin/types/media";

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
 * An item's stored sizes as an object. Most adapters return the column as an
 * object; one that stores it as text returns a JSON string, and a string that
 * doesn't parse counts as no sizes.
 */
export function parseMediaSizes(
  sizes: Record<string, ImageSizeVariant> | string | null | undefined
): Record<string, ImageSizeVariant> | null {
  if (!sizes) return null;
  if (typeof sizes === "object") return sizes;
  try {
    const parsed: unknown = JSON.parse(sizes);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, ImageSizeVariant>)
      : null;
  } catch {
    return null;
  }
}

/** What `wholeImageSrc` reads from an item. */
export interface WholeImageSource {
  url: string;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
  sizes?: Record<string, ImageSizeVariant> | string | null;
}

/**
 * Whether a stored size shows the whole image: its sides keep the image's
 * proportions, to within the pixel a resize rounds to. A size fitted inside
 * a box does; one cropped to a box of other proportions doesn't. The variant
 * records no fit setting, so its proportions are what tell the two apart.
 */
function showsWholeImage(
  variant: ImageSizeVariant,
  width: number,
  height: number
): boolean {
  if (!variant.url || !(variant.width > 0) || !(variant.height > 0)) {
    return false;
  }
  return (
    Math.abs(variant.width * height - variant.height * width) <=
    Math.max(width, height)
  );
}

/**
 * Where to draw an item's whole image from, for a tile: the smallest stored
 * copy that still shows the whole picture, so a page of tiles doesn't
 * download every original.
 *
 * 1. The smallest stored size whose proportions are the image's.
 * 2. Otherwise the thumbnail, but only for a square image: the thumbnail is
 *    a square cut from the middle, which is the whole picture only then.
 * 3. Otherwise the file itself. Unknown dimensions land here too: a crop
 *    shown as the whole image is the mistake this exists to prevent, and a
 *    larger download is the safe side.
 *
 * The one place a tile's image is chosen, so fitted thumbnails, when they
 * exist, change this function and nothing else.
 */
export function wholeImageSrc(media: WholeImageSource): string {
  const { width, height } = media;
  if (
    !(typeof width === "number" && width > 0) ||
    !(typeof height === "number" && height > 0)
  ) {
    return media.url;
  }
  const fitted = Object.values(parseMediaSizes(media.sizes) ?? {})
    .filter(variant => showsWholeImage(variant, width, height))
    .sort((a, b) => a.width * a.height - b.width * b.height)[0];
  if (fitted) return fitted.url;
  if (width === height && media.thumbnailUrl) return media.thumbnailUrl;
  return media.url;
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
