/**
 * Where a stylesheet this package emits is allowed to fetch from. React-free.
 *
 * One module because there is one question. It was previously answered twice —
 * once for custom CSS and once for structured style values — and the two copies
 * immediately disagreed: the sanitizer normalised a URL the way the WHATWG URL
 * parser does, and the compiler used `trim()` and a scheme regexp, so a value
 * carrying a leading U+0001 was refused in one and emitted by the other. A
 * second implementation of a security check is a second thing to be wrong, and
 * it will be wrong in a way the first one already taught you about.
 *
 * @module core/url-policy
 */

/**
 * The leading and trailing run the URL parser discards.
 *
 * "Remove any leading and trailing C0 control or space from input." C0 is
 * U+0000 to U+001F, which `trim()` does not cover — U+0001 is not whitespace,
 * so a scheme hidden behind one survives a trim while resolving to the same
 * host. Scanned by code point rather than matched, because a regexp holding
 * literal control characters is its own hazard to read and to lint.
 */
function trimControlsAndSpace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

/**
 * A URL as the browser's parser will read it, rather than as it was written.
 *
 * The two removals are the first steps of the WHATWG basic URL parser, quoted
 * beside each. Guessing at this produced two bypasses in the sanitizer — a tab
 * inside a scheme, then a U+0001 in front of one — so it follows the algorithm
 * rather than the cases anyone happened to think of.
 */
export function normalizeUrl(value: string): string {
  const withoutBreaks = value
    // "Remove all ASCII tab or newline from input."
    .replace(/[\t\n\r]/g, "")
    // Backslashes are read as slashes for http and https, so `/\\evil/a`
    // reaches another host while beginning with neither `//` nor a scheme.
    .replaceAll("\\", "/");
  return trimControlsAndSpace(withoutBreaks);
}

/** Any `scheme:` prefix, tolerating the whitespace a value may carry. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Whether a URL reaches anywhere other than the document's own origin. */
export function isRemoteUrl(value: string): boolean {
  const normalized = normalizeUrl(value);
  if (URL_SCHEME.test(normalized)) return true;
  // No scheme, but still another host: `//evil.example/x.png` inherits the
  // page's protocol and nothing else.
  return normalized.startsWith("//");
}

/**
 * One host a block image may be loaded from.
 *
 * Deliberately the shape of Next.js's `images.remotePatterns`, because a Nextly
 * app already declares the same thing there for `next/image` and copying the
 * entry across should just work.
 */
export interface RemotePattern {
  protocol?: "http" | "https";
  hostname: string;
  port?: string;
  pathname?: string;
}

function hostnameMatches(pattern: string, hostname: string): boolean {
  if (pattern === hostname) return true;
  // `**.example.com` matches any depth of subdomain but not the bare apex,
  // which is what Next.js does and what the extra star is understood to mean.
  if (pattern.startsWith("**.")) return hostname.endsWith(pattern.slice(2));
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    if (!hostname.endsWith(suffix)) return false;
    const label = hostname.slice(0, hostname.length - suffix.length);
    return label !== "" && !label.includes(".");
  }
  return false;
}

/**
 * Next.js pathname semantics: `*` is one segment, `**` is any depth.
 *
 * Treating everything without a trailing `/**` as a literal rejected
 * `pathname: "/img/*"`, which Next.js accepts — so a config copied across as
 * this type advertises silently stopped matching, and the image vanished with
 * no explanation. Compared segment by segment rather than by building a regexp,
 * because the path is attacker-influenced and a regexp assembled from it is a
 * second problem.
 */
function pathnameMatches(
  pattern: string | undefined,
  pathname: string
): boolean {
  if (pattern === undefined) return true;
  const want = pattern.split("/");
  const got = pathname.split("/");
  for (let i = 0; i < want.length; i += 1) {
    const segment = want[i];
    // `**` consumes the rest, but only as the final segment; anywhere else it
    // is not a form Next.js defines.
    if (segment === "**") return i === want.length - 1 && got.length > i;
    if (i >= got.length) return false;
    if (segment === "*") continue;
    if (segment !== got[i]) return false;
  }
  return want.length === got.length;
}

/**
 * Whether a remote URL is one this site has declared it loads from.
 *
 * Closed by default: with no patterns configured, nothing off-origin is
 * allowed. That is the same posture as `next/image`, and the posture the page
 * builder needs, because a remote URL is a request whose firing can be made
 * conditional by a custom-CSS selector — so an undeclared host is a channel
 * out, not merely an unexpected image.
 */
export function isAllowedRemoteUrl(
  url: string,
  patterns: readonly RemotePattern[]
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(normalizeUrl(url));
  } catch {
    return false;
  }
  // A pattern that names no protocol means "either of the two this type
  // allows", not "any scheme at all". Checking here rather than per pattern so
  // an omitted field cannot reopen it.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return patterns.some(pattern => {
    if (
      pattern.protocol !== undefined &&
      `${pattern.protocol}:` !== parsed.protocol
    ) {
      return false;
    }
    if (!hostnameMatches(pattern.hostname, parsed.hostname)) return false;
    if (pattern.port !== undefined && pattern.port !== parsed.port)
      return false;
    return pathnameMatches(pattern.pathname, parsed.pathname);
  });
}

/**
 * Whether a URL written in a stylesheet may be fetched.
 *
 * Same-origin always; off-origin only from a declared host. Protocol-relative
 * is refused outright rather than resolved against a guess: `//cdn/a.png`
 * inherits the DOCUMENT's protocol, which is not knowable when the stylesheet
 * is compiled, and assuming https accepted it against an https-only pattern on
 * a page that then fetched it over http. An author who wants that host can
 * write the scheme.
 */
export function isFetchableUrl(
  url: string,
  patterns: readonly RemotePattern[]
): boolean {
  if (!isRemoteUrl(url)) return true;
  if (normalizeUrl(url).startsWith("//")) return false;
  return isAllowedRemoteUrl(url, patterns);
}
