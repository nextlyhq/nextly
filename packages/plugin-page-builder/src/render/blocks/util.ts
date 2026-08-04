import { isFetchableUrl, type RemotePattern } from "../../core/url-policy";

/**
 * A URL safe to NAVIGATE to: an `href`, a form `action`.
 *
 * Scheme safety only. Allows http(s)/relative/mailto/tel; browsers ignore ASCII
 * control chars and whitespace when parsing a scheme (so `java\tscript:` still
 * executes), so those are stripped before testing — matching the raw string
 * alone is an XSS bypass.
 *
 * NOT for anything the browser fetches by itself. A link is followed when
 * someone clicks it, so its host is the author's business; an `src` is
 * requested without asking, and whether that request happens can be made
 * conditional by CSS — which is the channel {@link mediaUrl} exists to close.
 * Use `mediaUrl` for `src`, `poster`, `srcSet` and inline backgrounds. This
 * function was used for the `core/image` source and that is exactly how the
 * primary image block stayed reachable after backgrounds were gated.
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
 * Resolve a media prop (raw URL string, `{ url }` object, or a bound value) to a
 * safe URL this page is allowed to load.
 *
 * Two questions, and the second is the one that was missing. `safeUrl` asks
 * whether the scheme is dangerous; this also asks whether the ORIGIN is one the
 * site declared. A block renders its media into an `src` or an inline
 * background, which never passes through the style compiler, so the policy that
 * gates a structured `backgroundImage` has to be applied here too — otherwise
 * an undeclared host is still reachable, and custom CSS can gate the request on
 * a selector by overriding the inline background conditionally.
 *
 * Every block reads its media through this one function, so the check lives
 * here rather than at the eleven call sites that would each have to remember.
 */
export function mediaUrl(
  v: unknown,
  remotePatterns: readonly RemotePattern[] = []
): string | undefined {
  const raw =
    typeof v === "string"
      ? safeUrl(v)
      : v && typeof v === "object" && "url" in v
        ? safeUrl((v as { url?: unknown }).url)
        : undefined;
  if (raw === undefined) return undefined;
  return isFetchableUrl(raw, remotePatterns) ? raw : undefined;
}

/** Read a media prop's alt text if present. */
export function mediaAlt(v: unknown): string {
  if (v && typeof v === "object" && "alt" in v) {
    return str((v as { alt?: unknown }).alt);
  }
  return "";
}
