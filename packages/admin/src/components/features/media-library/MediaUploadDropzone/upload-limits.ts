/**
 * What the admin knows of the server's upload limits before a file is sent:
 * the types it accepts and the per-file size, and how to say both to a
 * person. The library's drop-anywhere and the media picker's drop area read
 * them from here, so the two refuse the same files for the same reasons.
 *
 * The types are DERIVED from the list the server validates against
 * (`DEFAULT_ACCEPTED_FORMATS` from `nextly/config`). The size is the server's
 * DEFAULT `limits.fileSize`: the configured value is not sent to the admin,
 * so an install that changes it is judged here by the default, and the
 * server's own answer, which is authoritative, shows on the file's row.
 */

import { DEFAULT_ACCEPTED_FORMATS, WEB_FONT_FORMATS } from "nextly/config";
import type { Accept, FileError } from "react-dropzone";

import { formatFileSize } from "@admin/lib/media-utils";

/**
 * The extensions a family filter stands for, DERIVED from what the server
 * actually accepts.
 *
 * React Dropzone matches a file by type OR by suffix, and a browser reporting
 * no type — which it does for any format its platform does not register — has
 * only the suffix left. So this list decides what can be dragged at all.
 *
 * Written by hand it disagreed with the server in both directions: it offered
 * AVI and MOV, which the allowlist refuses, and withheld AVIF, SVG, WebM and
 * every audio format, which the allowlist accepts. Reading the same list the
 * server validates against is what stops the two drifting again.
 *
 * The wildcard itself stays permissive on purpose: an install that widens
 * `additionalMimeTypes` accepts types this build cannot know, and matching the
 * family lets those through to the server that configured them.
 */
const FAMILY_PREFIXES = ["image/", "video/", "audio/"] as const;

const EXTENSIONS_BY_FAMILY: Record<string, readonly string[]> =
  Object.fromEntries(
    [...FAMILY_PREFIXES, "font/"].map(family => [
      `${family}*`,
      DEFAULT_ACCEPTED_FORMATS.filter(format =>
        format.mimeType.startsWith(family)
      ).flatMap(format => format.extensions),
    ])
  );

/**
 * The family wildcards the DEFAULT map offers, with the suffixes the server
 * accepts under each.
 *
 * The wildcard is what keeps a configured install working: an install that adds
 * `image/heic` through `additionalMimeTypes` is accepted by the server, and an
 * exact-type map built from this build's defaults would refuse it in the
 * browser before a request existed. The family lets it through to the
 * authoritative validator; the extensions stay truthful for the default config.
 */
const EXTENSIONS_BY_FAMILY_ACCEPT: Accept = Object.fromEntries(
  FAMILY_PREFIXES.map(family => [
    `${family}*`,
    [...(EXTENSIONS_BY_FAMILY[`${family}*`] ?? [])],
  ])
);

/**
 * Default accepted file types for dropzone
 *
 * - Images: PNG, JPG, JPEG, GIF, WebP
 * - Videos: MP4, MOV, AVI
 * - Documents: PDF
 * - Fonts: WOFF2, WOFF
 */
export const DEFAULT_ACCEPTED_FILE_TYPES: Accept = {
  ...EXTENSIONS_BY_FAMILY_ACCEPT,
  /*
   * Exact types for what belongs to no family wildcard, and for fonts
   * deliberately: `font/*` would admit TTF and OTF, which the server refuses
   * because nothing converts them — a file accepted here and rejected there is
   * a rejection an author only meets after the upload.
   */
  ...Object.fromEntries(
    DEFAULT_ACCEPTED_FORMATS.filter(
      format => !FAMILY_PREFIXES.some(f => format.mimeType.startsWith(f))
    ).map(format => [format.mimeType, [...format.extensions]])
  ),
  ...Object.fromEntries(
    WEB_FONT_FORMATS.map(format => [format.mimeType, [format.extension]])
  ),
};

/**
 * Default maximum file size. Matches the server's default `limits.fileSize`
 * (10MB) so the client pre-check and the server agree; the server stays
 * authoritative and its per-file errors render on the queue rows either way.
 */
export const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

/**
 * Each web font type against its extension, taken from the shared table.
 *
 * A lookup rather than a second list: the formats themselves are declared once
 * on the server, and both the default map and an explicit filter read them from
 * there so an added format reaches every path that decides what may be dragged.
 */
const WEB_FONT_MIME_BY_TYPE = new Map(
  WEB_FONT_FORMATS.map(format => [format.mimeType, format.extension])
);

/**
 * The extensions one accepted type admits, or none for a type nothing here
 * knows — which leaves Dropzone matching on the MIME type alone, as before.
 */
function extensionsForAcceptedType(type: string): string[] {
  const family = EXTENSIONS_BY_FAMILY[type];
  if (family !== undefined) return [...family];

  // An exact type the server names, such as `application/pdf`, which belongs to
  // no family wildcard and would otherwise arrive here with no suffix at all.
  const exact = DEFAULT_ACCEPTED_FORMATS.find(
    format => format.mimeType === type
  );
  if (exact !== undefined) return [...exact.extensions];

  const webFont = WEB_FONT_MIME_BY_TYPE.get(type);
  if (webFont !== undefined) return [webFont];

  if (type.startsWith("image/")) {
    const subtype = type.split("/")[1] ?? "";
    // `image/jpeg` is written both ways on disk, and a picker naming the type
    // should accept the file however the author's camera spelled it.
    return subtype === "jpeg" ? [".jpeg", ".jpg"] : [`.${subtype}`];
  }

  return [];
}

/**
 * Convert MIME type string to react-dropzone Accept format
 *
 * Supports formats like:
 * - "image/*" -> { "image/*": [] }
 * - "image/png,image/jpeg" -> { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] }
 * - "application/pdf" -> { "application/pdf": [".pdf"] }
 */
export function parseAcceptString(acceptString?: string): Accept | undefined {
  if (!acceptString) return undefined;

  const accept: Accept = {};
  for (const type of acceptString.split(",").map(t => t.trim())) {
    accept[type] = extensionsForAcceptedType(type);
  }

  return Object.keys(accept).length > 0 ? accept : undefined;
}

/**
 * Formats whose own spelling is not simply their extension in capitals.
 *
 * Presentation only, and deliberately separate from the map above: WHICH
 * formats are offered stays derived, so an entry missing from here costs a
 * capital letter rather than an omission an author acts on.
 */
const EXTENSION_CASING: Record<string, string> = { webp: "WebP" };

/**
 * Name the formats an accept map actually admits.
 *
 * DERIVED from the map rather than restated beside it. The hand-written
 * version had already drifted: the map accepted WOFF and the copy named only
 * WOFF2, so an author holding a `.woff` read that it was unsupported and did
 * not try. A format the dropzone accepts but the copy omits is a format nobody
 * uses, and the two lists have no mechanism keeping them level.
 *
 * Extensions rather than mime types, because that is what an author sees on
 * their own file. Deduplicated through a Set: several entries can name the
 * same extension, and a repeated one reads as a mistake in the copy.
 */
function describeAcceptedTypes(accept: Accept): string {
  const labels = new Set<string>();
  for (const extensions of Object.values(accept)) {
    for (const extension of extensions) {
      const bare = extension.replace(/^\./, "");
      labels.add(EXTENSION_CASING[bare] ?? bare.toUpperCase());
    }
  }
  return [...labels].join(", ");
}

/**
 * Get human-readable file type description from accept string
 */
export function getAcceptDescription(
  acceptString: string | undefined,
  maxSize: number
): string {
  const sizeLimit = ` up to ${formatFileSize(maxSize)}`;

  if (!acceptString) {
    return `${describeAcceptedTypes(DEFAULT_ACCEPTED_FILE_TYPES)}${sizeLimit}`;
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
  if (acceptString.includes("font/")) {
    types.push("Fonts");
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
    default:
      return error.message;
  }
}
