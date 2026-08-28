/**
 * Reading stored props safely.
 *
 * A prop schema describes what an EDITOR offers, not what a document holds. The
 * engine validates props as an object and nothing more, so a stored node can
 * carry a number where a string was declared, a missing field, or a value a
 * migration left behind. Every block in this library reads through these rather
 * than trusting the declared type, for the same reason the renderer sanitizes
 * the tree: the input is a database row.
 *
 * @module blocks/props
 */
import {
  authoredText,
  isAuthoredText,
  isFetchableUrl,
  isLinkableUrl,
} from "@nextlyhq/blocks-engine";
import type { RemotePatternInput } from "@nextlyhq/blocks-engine";

/**
 * Whether a stored value is text an author actually put there.
 *
 * Re-exported from the engine rather than declared here, because link
 * eligibility is not the only decision this renderer shares with the plain-text
 * projections taken from the same document: what a page DRAWS and what a
 * description SAYS about it have to answer this identically, and a copy here
 * agreed on the day it was written and then drifted.
 *
 * Separate from {@link text} because a few props need to tell a MISSING value
 * from an empty one, and `text()` maps both to `""`. An image's `alt` is the
 * case that matters: absent means "nobody said", while an explicit `""` is the
 * documented way to mark an image decorative, and those call for opposite
 * behaviour.
 */
export { isAuthoredText };

/** A string prop, or the fallback when the stored value is not usable text. */
export function text(value: unknown, fallback = ""): string {
  return authoredText(value, fallback);
}

/** A stored value constrained to one of a fixed set, or the fallback. */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A boolean prop. Only a real boolean counts; a stored `"false"` is not one. */
export function flag(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** A finite number within bounds, or the fallback. */
export function number(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number }
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Schemes that execute rather than navigate.
 *
 * An ALLOWLIST, not a list of schemes to refuse.
 *
 * The refusing shape was tried first and is the wrong one here for the same
 * reason it is wrong in the style compiler: a blocklist has to predict every
 * dangerous scheme and misses the next one. `javascript:`, `vbscript:` and
 * `data:` were named, so `blob:` was not — and a `blob:` document runs in the
 * origin that created it, which is the page's own. Nor were `filesystem:`,
 * `about:`, or whatever a browser ships next.
 *
 * These four are what an author actually writes in a link or a source:
 * `http`/`https` for a destination, `mailto`/`tel` for the two that open an
 * app rather than a page and are the ordinary content of a contact button.
 * A stored URL reaches an `href` or an `src`, so this is the one prop type
 * where a bad value is code execution rather than a broken link.
 *
 * The SAME four the rich-text sanitizer allows, deliberately. That module
 * answers this identical question for stored rich text, and two surfaces of one
 * product disagreeing about which schemes are safe is how a value refused in a
 * link body becomes acceptable in a button beside it. The admin's link editor
 * accepts a wider set for what an author may TYPE; that is an input affordance
 * and not the boundary, which is here.
 */
/**
 * Any leading `scheme:`, which is what decides whether the list above applies.
 *
 * A value with NO scheme is left alone: `/about`, `a.png` and `#top` resolve
 * against the page's own origin and name no destination of their own. So does
 * `//host/x`, which carries no scheme and still reaches another host — bounding
 * WHICH hosts may be reached is a separate question, asked of the host policy
 * by the blocks that fetch, not of this list.
 */
/**
 * Whether a string still holds a control character.
 *
 * Scanned by code point rather than matched by a regular expression: a pattern
 * for these needs a lint suppression, and the rule it would suppress is there
 * because a literal control character in a pattern is invisible to whoever reads
 * it next. `0x20` is deliberately excluded — a space is not a control character,
 * and an interior one belongs to the path.
 */
/**
 * A URL safe to place in an attribute, or `undefined`.
 *
 * The scheme is read from the value as the BROWSER's parser will read it, using
 * the engine's own normalisation rather than a second copy of the rules — the
 * two disagreeing is how a scheme hides from one check while still navigating.
 * That removes tab, LF and CR wherever they appear, because the parser does,
 * and trims leading control characters and spaces, because the parser does.
 *
 * It deliberately does NOT remove an interior space. The parser does not either:
 * it percent-encodes one. Removing it invents a scheme that was never written —
 * `hero image:1.png` is an ordinary relative path to a file whose name has a
 * space, and collapsing it to `heroimage:1.png` would refuse it as an unknown
 * scheme.
 *
 * A control character left INSIDE after that normalisation refuses the value
 * outright. One never appears in a URL anybody meant, since it has to be
 * percent-encoded to survive, and its only use here is to break a scheme apart
 * so a reader sees no scheme where a browser may still see one. Refusing is the
 * answer that does not depend on which of those two a given browser does.
 *
 * The value RETURNED is the original trimmed string, not the normalised one, so
 * a legitimate URL is never silently rewritten.
 */
export function url(value: unknown): string | undefined {
  // The DECISION belongs to the engine, which owns what the stored format can
  // express — otherwise a renderer that draws nothing for an unusable link and
  // a flattener that still reports its label describe different pages. What
  // stays here is the return value: the original trimmed string, so a
  // legitimate URL is never silently rewritten into its normalised form.
  if (!isLinkableUrl(value)) return undefined;
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * `rel` for a link, given its target.
 *
 * A `target="_blank"` link hands the opened page a `window.opener` reference
 * unless told otherwise. Modern browsers imply `noopener`, but the peer range
 * covers what a visitor's browser does rather than what the newest one does,
 * and `noreferrer` is a privacy choice the implied default does not make.
 * A caller-supplied `rel` is kept and merged rather than replaced.
 */
export function relFor(
  target: string | undefined,
  supplied: unknown
): string | undefined {
  const parts = new Set(text(supplied).split(/\s+/).filter(Boolean));
  if (target === "_blank") {
    parts.add("noopener");
    parts.add("noreferrer");
  }
  return parts.size > 0 ? [...parts].join(" ") : undefined;
}

/**
 * Whether a URL's origin is one the host named as trusted.
 *
 * Compared as ORIGINS via the URL parser rather than by string prefix. A prefix
 * test on `https://player.example.com` also admits
 * `https://player.example.com.evil.test`, and a host-only test ignores the
 * scheme, so `http://` would pass a list that named `https://`. `URL.origin`
 * settles scheme, host and port together and lowercases the host, which is the
 * comparison the browser itself makes.
 *
 * A value that will not parse answers false. That covers a relative URL, which
 * has no origin of its own: it resolves to the page's own origin, and admitting
 * it here would be the one grant that lets a frame reach the document around
 * it. A host that genuinely wants that has to name the origin.
 *
 * An unparseable ENTRY is skipped rather than throwing, so one typo in a
 * configuration list cannot take down every page that renders an embed.
 */
export function isTrustedOrigin(
  value: string,
  trusted: readonly string[] | undefined
): boolean {
  if (trusted === undefined || trusted.length === 0) return false;
  const origin = originOf(value);
  if (origin === undefined) return false;
  return trusted.some(entry => originOf(entry) === origin);
}

/**
 * An explicit scheme followed by `//`, which is what makes a URL absolute to a
 * browser and not merely parseable by `new URL`.
 *
 * The two disagree, and the disagreement is exploitable. `new URL(x)` with no
 * base reads `https:player.example.com` as `https://player.example.com/`, while
 * an `iframe src` resolves it against the DOCUMENT — same scheme means relative
 * — producing `https://site.example/pages/player.example.com`. Comparing the
 * parser's answer would then match the allowlist while the browser loaded the
 * host's OWN origin, which is the one grant that lets a frame script the page
 * around it. `https:/player.example.com`, with one slash, does the same.
 *
 * So the authority has to be written out. This is the same refusal the relative
 * case already gets, applied to the forms that only LOOK absolute.
 */
const EXPLICIT_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i;

/** A URL's origin, or nothing when it has none this comparison can use. */
function originOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Trimmed for the allowlist's sake: entries are typed into configuration by
  // hand. The src arrives already trimmed by `url()`.
  const candidate = value.trim();
  if (!EXPLICIT_AUTHORITY.test(candidate)) return undefined;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }
  // "null" is what an opaque origin serialises to — a `data:` or `blob:` URL
  // among others. Treating that as a matchable value would let two unrelated
  // opaque origins compare equal.
  return parsed.origin === "null" ? undefined : parsed.origin;
}

/**
 * A stored URL this page is willing to turn into a REQUEST.
 *
 * TWO filters, both asked, in this order. `url()` refuses a scheme that could
 * execute and applies whether or not an operator configured anything, because a
 * `javascript:` value is not a site setting. `remotePatterns` is the site's own
 * list of hosts it will fetch from, and an ABSENT list means unasked rather than
 * allowed-nothing — the semantics {@link BlockHostPolicy} states for the field,
 * and the reason an existing site does not lose its images the day it upgrades.
 *
 * ONE implementation, because three surfaces ask it: an image block, an embed,
 * and the rich-text renderer's media. Each had its own copy, and a copy is not a
 * policy — a change to the accepted schemes, to normalisation, or to the order
 * the two filters run in would have moved one and left the others agreeing with
 * a rule that no longer existed, with every local version still looking correct.
 *
 * `undefined` where either filter refuses, so a caller decides what to draw in
 * its place rather than being handed a URL it must not request.
 */
export function fetchableUrl(
  value: unknown,
  patterns: readonly RemotePatternInput[] | undefined
): string | undefined {
  const safe = url(value);
  if (safe === undefined) return undefined;
  if (patterns === undefined) return safe;
  return isFetchableUrl(safe, patterns) ? safe : undefined;
}
