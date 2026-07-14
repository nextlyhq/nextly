/**
 * Reject dangerous URL schemes for image/link/video srcs. Allows http(s)/relative/
 * mailto/tel. Browsers ignore ASCII control chars + whitespace when parsing a scheme
 * (so `java\tscript:` still executes), so we strip those before testing — matching the
 * raw string alone is an XSS bypass.
 */
export function safeUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  // Strip control chars (U+0000–U+0020, U+007F) + whitespace, then test the scheme.
  // eslint-disable-next-line no-control-regex
  const scheme = trimmed.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
  if (/^(javascript|vbscript|data):/.test(scheme)) return undefined;
  return trimmed;
}

/** Read a string prop with a fallback (avoids `String(unknown)` stringification). */
export function str(v: unknown, fallback = ""): string {
  return typeof v === "string"
    ? v
    : typeof v === "number"
      ? String(v)
      : fallback;
}

/**
 * Resolve a media prop (raw URL string, `{ url }` object, or a bound value) to a safe URL.
 */
export function mediaUrl(v: unknown): string | undefined {
  if (typeof v === "string") return safeUrl(v);
  if (v && typeof v === "object" && "url" in v) {
    return safeUrl((v as { url?: unknown }).url);
  }
  return undefined;
}

/** Read a media prop's alt text if present. */
export function mediaAlt(v: unknown): string {
  if (v && typeof v === "object" && "alt" in v) {
    return str((v as { alt?: unknown }).alt);
  }
  return "";
}
