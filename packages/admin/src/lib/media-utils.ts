import { mediaCategoryOf } from "nextly/media-categories";

import type { MediaType } from "@admin/types/media";

/**
 * Determine media type from MIME type: core's one answer, which the library
 * query narrows to a type by too, so a badge and a filter agree.
 *
 * @param mimeType - MIME type string (e.g., "image/png"), or null/undefined
 * @returns MediaType enum value
 */
export function getMediaType(mimeType: string | null | undefined): MediaType {
  return mediaCategoryOf(mimeType);
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

/** What `mediaImageSrc` reads from an item. */
export interface MediaImageSource {
  url: string;
  thumbnailUrl?: string | null;
}

/**
 * What an image is drawn for: a `tile`, one of a page of many, or a
 * `preview`, one image on its own (the details panel, the viewer, the edit
 * dialog).
 */
export type MediaImagePurpose = "tile" | "preview";

/**
 * Where to draw an item's image from, for what it is drawn for. The one place
 * the choice is made.
 *
 * - A preview shows one image, whole and sharp: the original file.
 * - A tile is one of a page of many, so it takes the light copy: the stored
 *   thumbnail, the whole image fitted inside 480 by 480 (an older item's is a
 *   square, which the tile draws whole too); and the original only when there
 *   is no thumbnail.
 */
export function mediaImageSrc(
  media: MediaImageSource,
  { purpose }: { purpose: MediaImagePurpose }
): string {
  if (purpose === "preview") return media.url;
  return media.thumbnailUrl ?? media.url;
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
