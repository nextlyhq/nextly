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
