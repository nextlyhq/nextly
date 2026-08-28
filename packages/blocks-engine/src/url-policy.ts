/**
 * Which remote hosts a compiled page may fetch from.
 *
 * Lives in the engine rather than beside any one renderer because the same
 * question is asked from two places that must not answer it differently: the
 * style compiler judging a `url()` in a stored value, and a React block judging
 * an `img`/`iframe` source. A second implementation of a security check is a
 * second thing to be wrong, and two that drift apart fail silently — the sheet
 * permitting what the markup refuses, or the reverse.
 *
 * Deliberately the shape of `next/image`'s `images.remotePatterns`, because a
 * Nextly app already declares the same hosts there and copying the entry across
 * should just work.
 *
 * Runtime-free like the rest of this package: string and URL work only, no DOM
 * and no Node builtins, so it runs in a server render, in a browser canvas, and
 * in a test alike.
 *
 * @module url-policy
 */
import picomatch from "picomatch";

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
/**
 * Schemes a stored link may name.
 *
 * The format's own rule, not one renderer's. A value carrying any other scheme
 * is not a link this document can express, so nothing reading the document —
 * a renderer drawing it, a flattener describing it, an indexer searching it —
 * should treat it as one.
 */
const LINKABLE_SCHEMES: readonly string[] = ["http", "https", "mailto", "tel"];

/**
 * Any leading `scheme:`, which is what decides whether the list above applies.
 *
 * A value with NO scheme is left alone: `/about`, `a.png` and `#top` resolve
 * against the page's own origin and name no destination of their own. So does
 * `//host/x`, which carries no scheme and still reaches another host — bounding
 * WHICH hosts may be reached is a separate question, asked of the host policy
 * by the blocks that fetch, not of this list.
 */
const LINK_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Whether a string still holds a control character.
 *
 * A URL parser strips these before reading the scheme, so `java\tscript:`
 * becomes `javascript:` in the browser while looking like a scheme-less path to
 * a check that does not. Refused outright rather than stripped: a URL carrying
 * one is malformed however it was meant.
 *
 * Scanned by code point rather than matched by a regular expression: a pattern
 * for these needs a lint suppression, and the rule it would suppress is there
 * because a literal control character in a pattern is invisible to whoever reads
 * it next. `0x20` is deliberately excluded — a space is not a control character,
 * and an interior one belongs to the path.
 *
 * Exported for `style/css-value`, which asks the same question of a URL inside
 * a CSS value. Two copies of this is two chances for one of them to start
 * treating a byte differently, and the byte in question is the one that hides a
 * scheme.
 */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Whether a stored value names a link this document can express.
 *
 * Asked of the FORMAT rather than of a renderer, because more than one reader
 * has to agree about it: a renderer that draws nothing for an unusable link and
 * a flattener that still reports its label describe different pages, and the
 * description is the one nobody looks at until a crawler does.
 *
 * The scheme is read as the BROWSER's parser will read it — after normalising
 * the tab, newline and leading-control tricks that hide one — so a value cannot
 * pass here and mean something else in an attribute.
 *
 * @param value - anything a stored document might hold in a link position
 * @returns whether a reader should treat it as a link
 */
export function isLinkableUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;

  const normalized = normalizeUrl(trimmed);
  if (normalized === "") return false;
  if (hasControlCharacter(normalized)) return false;

  const scheme = LINK_SCHEME.exec(normalized);
  if (scheme === null) return true;
  const name = scheme[1];
  if (name === undefined) return false;
  return LINKABLE_SCHEMES.includes(name.toLowerCase());
}

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
/**
 * A pattern, or a `URL` standing in for one.
 *
 * `next.config` accepts `remotePatterns: [new URL("https://cdn.example/img/**")]`
 * as well as the object form, and a `URL` already carries every field this
 * matches on. Its `protocol` keeps the trailing colon, which is why the
 * comparison below strips one from both sides rather than appending one — the
 * same accommodation `matchRemotePattern` makes.
 *
 * **A `URL` is STRICTER than the object spelling that looks like it**, and the
 * difference is easy to be surprised by. A `URL` answers `""` for a `port` and a
 * `search` it does not have, while the object form leaves them undefined, and an
 * omitted field means "anything" here while an empty one means "exactly empty".
 * So `new URL("https://cdn.example/img/**")` matches only the default port AND
 * only a URL with no query string, where
 * `{ protocol: "https", hostname: "cdn.example", pathname: "/img/**" }` accepts
 * any port and any query. An image requested as `?v=2` is refused by the first
 * and admitted by the second.
 *
 * This is not a quirk of this implementation. `next/image`'s `matchRemotePattern`
 * takes `RemotePattern | URL` and applies the same `!== undefined` tests to
 * both, so a `URL` narrows it there in exactly the same way. Normalising the
 * empty strings away here would be friendlier in isolation and WRONG in the way
 * that matters: the reason this type takes a `URL` at all is that an entry
 * copied from `next.config` should behave identically, and a rule that admitted
 * more here than it does for `next/image` would leave a site believing one
 * boundary while running two.
 *
 * Write the object form when the intent is "any port, any query".
 */
export type RemotePatternInput = URL | RemotePattern;

export interface RemotePattern {
  protocol?: "http" | "https";
  /** A picomatch glob, as `next/image` reads it: `**.example.com`, `cdn.example`. */
  hostname: string;
  port?: string;
  /** A picomatch glob. `/img/*` is one segment, `/img/**` is that path and below. */
  pathname?: string;
  search?: string;
}

/**
 * Compiled matchers, keyed by the pattern text.
 *
 * `makeRe` is not cheap and a page compiles many values against the same few
 * patterns, so each glob is compiled once. Keyed by text rather than by the
 * pattern object, since callers build a fresh object per render.
 */
const globCache = new Map<string, RegExp>();

function glob(pattern: string, dot = false): RegExp {
  const key = `${dot ? "d:" : ":"}${pattern}`;
  const cached = globCache.get(key);
  if (cached !== undefined) return cached;
  const compiled = picomatch.makeRe(pattern, dot ? { dot: true } : undefined);
  globCache.set(key, compiled);
  return compiled;
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
  patterns: readonly RemotePatternInput[]
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
  // Beyond what Next.js checks, and deliberately: `next/image` receives URLs
  // that are already constrained, while this compiles whatever a style value
  // holds. A pattern that names no protocol means "either of the two this type
  // allows", not "any scheme".
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return patterns.some(pattern => {
    // Field order and glob options mirror `matchRemotePattern` in Next.js, and
    // the matching is delegated to the same library it uses. This type says a
    // `next.config` entry can be copied across, and that claim only holds if
    // the globs mean the same thing: picomatch's `*` spans dots in a hostname,
    // `/img/*` is one path segment, and a terminal `/img/**` matches `/img`
    // itself. Any reimplementation is a second definition of those semantics,
    // free to drift from the one the copied config was written against.
    // Stripped from both sides: an object pattern writes `https`, a `URL`
    // writes `https:`, and both mean the same scheme.
    const scheme = (value: string): string => value.replace(/:$/, "");
    if (
      pattern.protocol !== undefined &&
      pattern.protocol !== "" &&
      scheme(pattern.protocol) !== scheme(parsed.protocol)
    ) {
      return false;
    }
    if (pattern.port !== undefined && pattern.port !== parsed.port) {
      return false;
    }
    if (!glob(pattern.hostname).test(parsed.hostname)) return false;
    if (pattern.search !== undefined && pattern.search !== parsed.search) {
      return false;
    }
    return glob(pattern.pathname ?? "**", true).test(parsed.pathname);
  });
}

/**
 * Whether a URL written in a stylesheet may be fetched.
 *
 * A RELATIVE path is always allowed; anything carrying a scheme or a host needs
 * a declared pattern. Note what that means and does not mean: an absolute URL
 * naming the site's own host still needs an entry, because nothing here knows
 * what the site's own host is — the stylesheet is compiled once and may be
 * served from anywhere, so "same origin" is a property of the request rather
 * than of the text. This is the same rule `next/image` applies, where
 * `https://your-own-site.com/a.png` is refused until the host is in
 * `remotePatterns` while `/a.png` needs nothing. Supplying an origin here
 * instead would be a second way to express what one pattern entry already says.
 *
 * Protocol-relative is refused outright rather than resolved against a guess:
 * `//cdn/a.png` inherits the DOCUMENT's protocol, which is not knowable when
 * the stylesheet is compiled, and assuming https accepted it against an
 * https-only pattern on a page that then fetched it over http. An author who
 * wants that host can write the scheme.
 */
export function isFetchableUrl(
  url: string,
  patterns: readonly RemotePatternInput[]
): boolean {
  if (!isRemoteUrl(url)) return true;
  if (normalizeUrl(url).startsWith("//")) return false;
  return isAllowedRemoteUrl(url, patterns);
}
