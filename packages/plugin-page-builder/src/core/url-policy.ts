import { asciiLower, decodeIdentifier } from "@nextlyhq/blocks-engine";
import * as csstree from "css-tree";
import picomatch from "picomatch";

/**
 * Where a stylesheet this package emits is allowed to fetch from. React-free.
 *
 * One module, because "may this be fetched" is one question however many
 * surfaces ask it — custom CSS, structured style values, block attributes and
 * sanitized embed markup all reduce to it. Each of those judges a different
 * thing and reaches its own verdict, but they must agree on what a URL IS and
 * how it normalises, since that is where the subtleties are: a value carrying
 * a leading U+0001 is one URL to the WHATWG parser and another to `trim()`
 * plus a scheme test, and only one of those readings is the browser's.
 *
 * Keeping the definition here rather than per-caller is what makes those
 * agree. A second implementation of a security check is a second thing to be
 * wrong, and the surfaces that share this one cannot drift apart while the
 * scan is a single function.
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
/**
 * A function name as CSS reads it: escapes decoded, then ASCII-folded.
 *
 * css-tree keeps the spelling it was given, so `a\\74tr(...)` arrives as the
 * name `a\\74tr` while a browser reads it as `attr()`. Folding without decoding
 * first leaves it unrecognised — recorded as an ordinary function, never
 * matched against the substitution set, and never caught by the attr guard that
 * exists because an `attr()` in a URL position has no literal to inspect.
 */
export function functionName(raw: string): string {
  return asciiLower(decodeIdentifier(raw));
}

export const SUBSTITUTION_FUNCTIONS = new Set(["var", "env", "attr"]);

/**
 * An `attr()` standing where the value would be FETCHED rather than read.
 *
 * Unlike every other shape these scans look at, `attr()` has no literal in the
 * stylesheet to inspect: the value arrives from an author-controlled DOM
 * attribute at use time, so `image-set(attr(data-probe) 1x)` names a request
 * whose destination this parser cannot see. In a text position the same
 * function is ordinary — `content: attr(data-label)` — which is why the answer
 * depends on where it sits and not on the function alone.
 *
 * CSS Values 5 forbids the fetching case independently: the working group
 * resolved to make `type(<url>)` invalid inside `attr()`, and an
 * `attr()`-tainted value may not be used in a URL context at all. So refusing
 * costs no legitimate stylesheet anything, and it means the guarantee does not
 * rest on every engine having implemented that taint correctly — support for
 * `attr()` outside `content` is still marked experimental.
 *
 * Shared by both scans deliberately. They reach different verdicts (one
 * compares against an allowlist, the other refuses every remote origin) but
 * they read POSITION the same way, and a second copy of this rule is how one
 * of them would come to disagree with the other.
 */
export function attrFetchesFromDom(
  node: csstree.CssNode,
  position: readonly string[]
): boolean {
  if (node.type !== "Function" || functionName(node.name) !== "attr")
    return false;
  const enclosing = position[position.length - 1];
  return enclosing !== undefined && !TEXT_ARGUMENT_FUNCTIONS.has(enclosing);
}

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
  unreadable?: "depth" | "syntax" | "attr";
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
  outerPosition: readonly string[] = [],
  // Every string counts, whatever position it sits in. True for a custom
  // property, whose value is checked as though it could land anywhere: the
  // declaration that consumes it holds only `var(--x)` and carries no literal
  // of its own, so the string has to be judged where it is written or nowhere.
  anyPositionFetches = false
): FetchableValues {
  const values: string[] = [];
  const raws: { text: string; position: string[] }[] = [];
  const functions: string[] = [];
  // An `attr()` standing where a URL would be fetched. Recorded rather than
  // returned mid-walk so the values found so far still reach the caller.
  let attrInFetchPosition = false;
  csstree.walk(value, {
    enter(node: csstree.CssNode) {
      if (node.type === "Function") functions.push(functionName(node.name));
      // The nearest enclosing function that actually decides what a string is;
      // substitutions stand in for a value and decide nothing, so the position
      // they sit in is the one that counts.
      const position = [
        ...outerPosition,
        ...functions.filter(name => !SUBSTITUTION_FUNCTIONS.has(name)),
      ];
      // No literal to read: the URL would arrive from a DOM attribute at use
      // time, so this is a request whose destination the scan cannot see.
      if (
        node.type === "Function" &&
        functionName(node.name) === "attr" &&
        (anyPositionFetches || attrFetchesFromDom(node, position))
      )
        attrInFetchPosition = true;
      if (node.type === "Url") {
        values.push(node.value);
        return;
      }
      if (node.type === "Raw") {
        raws.push({ text: node.value, position });
        return;
      }
      if (node.type !== "String") return;
      if (anyPositionFetches) {
        values.push(node.value);
        return;
      }
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

  // Ahead of the `Raw` re-parse: an unreadable value is refused either way, and
  // this reason names the actual cause rather than whatever the nested walk
  // happens to report first.
  if (attrInFetchPosition) return { values, unreadable: "attr" };

  for (const raw of raws) {
    if (raw.text.trim() === "") continue;
    if (depth >= MAX_VALUE_NESTING) return { values, unreadable: "depth" };
    let reparsed: csstree.CssNode;
    try {
      reparsed = csstree.parse(raw.text, { context: "value" });
    } catch {
      return { values, unreadable: "syntax" };
    }
    const nested = fetchableValues(
      reparsed,
      depth + 1,
      raw.position,
      anyPositionFetches
    );
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
/**
 * A pattern, or a `URL` standing in for one.
 *
 * `next.config` accepts `remotePatterns: [new URL("https://cdn.example/img/**")]`
 * as well as the object form, and a `URL` already carries every field this
 * matches on. The only difference is that its `protocol` keeps the trailing
 * colon, which is why the comparison below strips one from both sides rather
 * than appending one — the same accommodation `matchRemotePattern` makes.
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
