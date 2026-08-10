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

/** A string prop, or the fallback when the stored value is not usable text. */
/**
 * Whether a stored value is text an author actually put there.
 *
 * Separate from {@link text} because a few props need to tell a MISSING value
 * from an empty one, and `text()` maps both to `""`. An image's `alt` is the
 * case that matters: absent means "nobody said", while an explicit `""` is the
 * documented way to mark an image decorative, and those call for opposite
 * behaviour. Sharing this predicate keeps the two from drifting apart.
 */
export function isAuthoredText(value: unknown): boolean {
  // A number is text a person would recognise, and a stored `0` or `2024` is
  // almost always a value someone typed. Booleans, objects and null are not.
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function text(value: unknown, fallback = ""): string {
  return isAuthoredText(value) ? String(value) : fallback;
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
 * `javascript:` and `vbscript:` run code in the page's origin, and `data:` can
 * carry an HTML document that then runs its own scripts in some browsers. A
 * stored URL reaches an `href` or an `src` attribute, so this is the one prop
 * type where a bad value is an XSS rather than a broken link.
 */
const EXECUTABLE_SCHEME = /^(javascript|vbscript|data):/i;

/**
 * A URL safe to place in an attribute, or `undefined`.
 *
 * The scheme is tested against a form with control characters and whitespace
 * REMOVED, because a browser strips them before resolving: `java\0script:` and
 * `java\tscript:` both navigate to a `javascript:` URL while failing a naive
 * prefix test. The value returned is the ORIGINAL trimmed string rather than
 * the stripped one, so a legitimate URL is not silently rewritten.
 */
export function url(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  // Filtered by code point rather than by a regex over a control-character
  // range, which needs a lint exemption to write and is easy to get subtly
  // wrong. Everything at or below U+0020, plus DEL, is dropped before the
  // scheme is read.
  let collapsed = "";
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 0x20 && code !== 0x7f) collapsed += character;
  }
  return EXECUTABLE_SCHEME.test(collapsed) ? undefined : trimmed;
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
