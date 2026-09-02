/**
 * Upload Validation — MIME Type Allowlist & Hard-Block
 *
 * Two-layer model: `BLOCKED_MIME_TYPES` rejects unconditionally
 * (overrides the allowlist), then the positive allowlist accepts the
 * rest. Wildcards (`image/*`) are supported.
 *
 * @module services/upload-validation/mime
 */

import {
  canonicalWebFontMime,
  matchesWebFontSignature,
  WEB_FONT_FORMATS,
} from "./web-fonts";

export const BLOCKED_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "text/javascript",
  "application/ecmascript",
  "text/ecmascript",
]);

/**
 * One accepted format: what it is called, and what it is called on disk.
 *
 * The extensions are here because a CLIENT needs them and only this list knows
 * which types are accepted. A browser reports no type for formats its platform
 * does not register, so a picker matching on the suffix is the difference
 * between a file being draggable and not — and a picker keeping its own list
 * drifts from this one, which is how a dropzone comes to advertise a format the
 * server refuses and refuse one the server accepts.
 */
export interface AcceptedFormat {
  readonly mimeType: string;
  readonly extensions: readonly string[];
}

/**
 * The formats an upload may carry when the caller names none.
 *
 * SVG is included — allowed but sanitized downstream.
 */
export const DEFAULT_ACCEPTED_FORMATS: readonly AcceptedFormat[] = [
  { mimeType: "image/jpeg", extensions: [".jpg", ".jpeg"] },
  { mimeType: "image/png", extensions: [".png"] },
  { mimeType: "image/gif", extensions: [".gif"] },
  { mimeType: "image/webp", extensions: [".webp"] },
  { mimeType: "image/avif", extensions: [".avif"] },
  { mimeType: "image/svg+xml", extensions: [".svg"] },
  { mimeType: "application/pdf", extensions: [".pdf"] },
  { mimeType: "video/mp4", extensions: [".mp4"] },
  { mimeType: "video/webm", extensions: [".webm"] },
  { mimeType: "audio/mpeg", extensions: [".mp3"] },
  { mimeType: "audio/wav", extensions: [".wav"] },
  { mimeType: "audio/ogg", extensions: [".ogg"] },
  // Web fonts, from the table that declares them, so a format added there is
  // accepted here without this list being edited.
  ...WEB_FONT_FORMATS.map(format => ({
    mimeType: format.mimeType,
    extensions: [format.extension],
  })),
];

/**
 * Default allowlist when the caller doesn't specify `allowedMimeTypes`
 * or `additionalMimeTypes`.
 *
 * DERIVED from the formats above so the types a server accepts and the suffixes
 * a client offers cannot disagree — they are two views of one list.
 */
export const DEFAULT_ALLOWED_MIME_TYPES: readonly string[] =
  DEFAULT_ACCEPTED_FORMATS.map(format => format.mimeType);

export type MimeValidationResult =
  | { ok: true }
  | { ok: false; reason: "blocked" | "not-allowed" };

/**
 * Build the effective allowlist from optional caller config. Resolution:
 * explicit `allowedMimeTypes` is a full override (ignores
 * `additionalMimeTypes`); otherwise `additionalMimeTypes` is merged with
 * the defaults. Blocked types are stripped from the result with a
 * single `console.warn` per entry so misconfigurations surface at boot.
 */
export function resolveAllowlist(
  allowedMimeTypes: string[] | undefined,
  additionalMimeTypes: string[] | undefined
): string[] {
  let resolved: string[];

  if (allowedMimeTypes && allowedMimeTypes.length > 0) {
    resolved = [...allowedMimeTypes];
  } else if (additionalMimeTypes && additionalMimeTypes.length > 0) {
    resolved = [
      ...new Set([...DEFAULT_ALLOWED_MIME_TYPES, ...additionalMimeTypes]),
    ];
  } else {
    resolved = [...DEFAULT_ALLOWED_MIME_TYPES];
  }

  /*
   * Canonicalised, not merely lowercased. A full override naming a font by its
   * legacy spelling — `allowedMimeTypes: ["application/x-font-woff"]` — would
   * otherwise hold that spelling while an upload's claim arrives canonicalised,
   * and the two never meet: the install advertises a format it then refuses.
   */
  resolved = resolved.map(t => {
    const lower = t.toLowerCase().trim();
    return canonicalWebFontMime(lower) ?? lower;
  });

  const blockedInConfig = resolved.filter(t => BLOCKED_MIME_TYPES.has(t));
  for (const t of blockedInConfig) {
    console.warn(
      `[nextly] Warning: '${t}' was in allowedMimeTypes but is blocked for security. Stripped.`
    );
  }
  return resolved.filter(t => !BLOCKED_MIME_TYPES.has(t));
}

/**
 * Validate a claimed MIME type against the allowlist. Hard-block takes
 * precedence; wildcard entries like `"image/*"` match any
 * `image/<subtype>`.
 */
export function validateMimeType(
  claimedMime: string,
  allowlist: readonly string[]
): MimeValidationResult {
  const normalized = claimedMime.toLowerCase().trim();

  if (BLOCKED_MIME_TYPES.has(normalized)) {
    return { ok: false, reason: "blocked" };
  }

  const isAllowed = allowlist.some(allowed => {
    if (allowed.endsWith("/*")) {
      return normalized.startsWith(allowed.slice(0, -1));
    }
    return normalized === allowed;
  });

  return isAllowed ? { ok: true } : { ok: false, reason: "not-allowed" };
}

/**
 * The accepted format a filename implies, if any.
 *
 * Over EVERY accepted format, not only fonts. A browser reports no type for
 * anything its platform does not register, and the dropzone offers each of
 * these by suffix — so a file it accepts locally and the server then refuses
 * for having no type is the same defect fonts had, wearing another extension.
 *
 * @param filename - The uploaded name, read case-insensitively
 */
export function acceptedMimeFromFilename(filename: string): string | undefined {
  const lower = filename.toLowerCase();
  return DEFAULT_ACCEPTED_FORMATS.find(format =>
    format.extensions.some(extension => lower.endsWith(extension))
  )?.mimeType;
}

/**
 * The type an upload claims, filled in from its name where nothing was sent.
 *
 * ONE implementation, because four upload entry points need the same answer and
 * each names its file differently — so the resolution lives here rather than
 * beside each of them, where a reader looking for one spelling sees a subset.
 *
 * A browser reports no type for formats its platform does not register, and
 * several multipart clients send `application/octet-stream` for the same
 * reason. Both are refused by an allowlist keyed on the type.
 *
 * A FONT claim answers to its signature here, under any spelling, because
 * `file-type` recognises neither WOFF nor WOFF2 — so nothing downstream can
 * check it, and this route serves those types to anonymous callers. Every other
 * inferred type is compared against the file's own bytes by
 * `detectAndCompareMime` further down the same pipeline, which every upload
 * path now runs.
 *
 * @param filename - The uploaded name
 * @param reportedType - The type the client sent, which may be empty
 * @param buffer - The uploaded bytes, which must back an inferred font type
 * @returns The type to validate and store, or `""` when a font claim's bytes
 *   do not support it
 */
export function resolveClaimedMimeType(
  filename: string,
  reportedType: string,
  buffer: Buffer
): string {
  const claimed = reportedType.trim();
  // Compared in lower case, because a client may spell the generic type
  // `Application/Octet-Stream` — mime tokens are case-insensitive.
  const generic = claimed.toLowerCase();

  /*
   * A font claim under ANY of its spellings, canonical or legacy, answers to
   * the bytes and comes back canonical. The allowlist knows one name per
   * format, so a claim arriving as `application/x-font-woff` is a font the
   * product accepts being refused for how the client spelled it.
   */
  const canonicalFont = canonicalWebFontMime(generic);
  if (canonicalFont !== undefined) {
    return matchesWebFontSignature(buffer, canonicalFont) ? canonicalFont : "";
  }

  if (generic !== "" && generic !== "application/octet-stream") {
    // Not a font by any spelling, so its bytes are somebody else's check.
    return claimed;
  }

  const inferred = acceptedMimeFromFilename(filename);
  if (inferred === undefined) return claimed;

  // A font name infers nothing unless the content agrees, since nothing
  // downstream can check this one.
  if (canonicalWebFontMime(inferred) !== undefined) {
    return matchesWebFontSignature(buffer, inferred) ? inferred : claimed;
  }
  return inferred;
}
