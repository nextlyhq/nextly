import * as csstree from "css-tree";
import picomatch from "picomatch";

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
 * Functions whose string arguments are text rather than something to fetch.
 *
 * An allowlist of the SAFE ones, deliberately, and the asymmetry is the reason.
 * Listing the URL-taking functions instead means an unlisted one is a MISS — a
 * leak — and that list is already hard to keep: `image()` and
 * `-webkit-image-set()` were both found only by probing. Listing the text-taking
 * ones means an unlisted function is refused, which costs a false positive and
 * a message. A security control should fail toward the annoyance.
 */
export const TEXT_ARGUMENT_FUNCTIONS = new Set([
  "counter",
  "counters",
  "format",
  "local",
  "symbols",
]);

/**
 * Functions that stand in for a value rather than holding one.
 *
 * Transparent to the question "is this string a URL": what a `var()` or
 * `attr()` fallback becomes depends entirely on where it sits, so it inherits
 * the position rather than defining one.
 */
export const SUBSTITUTION_FUNCTIONS = new Set(["var", "env", "attr"]);

/**
 * How deep a value may nest `Raw` fragments before the scan gives up.
 *
 * Values are short, so this exists to stop a hostile value recursing without
 * end rather than to bound cost. A real fallback chain bottoms out in a literal
 * after a handful of levels.
 */
export const MAX_VALUE_NESTING = 16;

/** What one value contained, and whether any of it could not be read. */
export interface FetchableValues {
  /** Every string or url the browser may fetch. */
  values: string[];
  /**
   * A fragment the parser could not resolve, and why. Unreadable is not the
   * same as safe: a caller refuses rather than emitting what it could not
   * check.
   */
  unreadable?: "depth" | "syntax";
}

/**
 * Every value in a parsed CSS value that the browser may fetch.
 *
 * Three shapes, and missing any of them reopens the channel:
 *
 * A `Url` node, which is the obvious one.
 *
 * A `String` used as a function ARGUMENT, since `image-set("https://…")`
 * fetches while `content: "https://…"` is a caption. Which functions take text
 * is the allowlist above; anything unclassified can fetch.
 *
 * A `Raw` node, which is where css-tree puts what it did not parse into a
 * value — a `var()` fallback among other things. The browser substitutes that
 * fallback in, so `filter: var(--missing, url("https://…"))` is a request that
 * carries its URL inside text this parser skipped. It is re-parsed and walked
 * with the enclosing functions carried across, because the same string is a
 * caption or an image depending on where the `var()` sits.
 */
export function fetchableValues(
  value: csstree.CssNode,
  depth = 0,
  outerPosition: readonly string[] = []
): FetchableValues {
  const values: string[] = [];
  const raws: { text: string; position: string[] }[] = [];
  const functions: string[] = [];
  csstree.walk(value, {
    enter(node: csstree.CssNode) {
      if (node.type === "Function") functions.push(node.name.toLowerCase());
      // The nearest enclosing function that actually decides what a string is;
      // substitutions stand in for a value and decide nothing, so the position
      // they sit in is the one that counts.
      const position = [
        ...outerPosition,
        ...functions.filter(name => !SUBSTITUTION_FUNCTIONS.has(name)),
      ];
      if (node.type === "Url") {
        values.push(node.value);
        return;
      }
      if (node.type === "Raw") {
        raws.push({ text: node.value, position });
        return;
      }
      if (node.type !== "String") return;
      const enclosing = position[position.length - 1];
      // A bare string is text: `content: "https://example.com"` is a caption.
      if (enclosing === undefined) return;
      if (TEXT_ARGUMENT_FUNCTIONS.has(enclosing)) return;
      values.push(node.value);
    },
    leave(node: csstree.CssNode) {
      if (node.type === "Function") functions.pop();
    },
  });

  for (const raw of raws) {
    if (raw.text.trim() === "") continue;
    if (depth >= MAX_VALUE_NESTING) return { values, unreadable: "depth" };
    let reparsed: csstree.CssNode;
    try {
      reparsed = csstree.parse(raw.text, { context: "value" });
    } catch {
      return { values, unreadable: "syntax" };
    }
    const nested = fetchableValues(reparsed, depth + 1, raw.position);
    values.push(...nested.values);
    if (nested.unreadable !== undefined) {
      return { values, unreadable: nested.unreadable };
    }
  }
  return { values };
}

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
  // Beyond what Next.js checks, and deliberately: `next/image` receives URLs
  // that are already constrained, while this compiles whatever a style value
  // holds. A pattern that names no protocol means "either of the two this type
  // allows", not "any scheme".
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return patterns.some(pattern => {
    // Field order and glob options mirror `matchRemotePattern` in Next.js,
    // because this type says a `next.config` entry can be copied across.
    // Reimplementing the globs disagreed with it three separate ways —
    // `/img/*`, `/img/**` against its own prefix, and `*.example.com` against a
    // deeper subdomain — so it uses the same matcher instead of an
    // approximation that has to be corrected one report at a time.
    if (
      pattern.protocol !== undefined &&
      `${pattern.protocol}:` !== parsed.protocol
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
  patterns: readonly RemotePattern[]
): boolean {
  if (!isRemoteUrl(url)) return true;
  if (normalizeUrl(url).startsWith("//")) return false;
  return isAllowedRemoteUrl(url, patterns);
}
