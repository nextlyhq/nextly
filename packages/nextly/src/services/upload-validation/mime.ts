/**
 * Upload Validation — MIME Type Allowlist & Hard-Block
 *
 * Two-layer model: `BLOCKED_MIME_TYPES` rejects unconditionally
 * (overrides the allowlist), then the positive allowlist accepts the
 * rest. Wildcards (`image/*`) are supported.
 *
 * @module services/upload-validation/mime
 */

export const BLOCKED_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "text/javascript",
  "application/ecmascript",
  "text/ecmascript",
]);

/**
 * Default allowlist when the caller doesn't specify `allowedMimeTypes`
 * or `additionalMimeTypes`. SVG is included — allowed but sanitized
 * downstream.
 */
export const DEFAULT_ALLOWED_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
];

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

  resolved = resolved.map(t => t.toLowerCase().trim());

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
