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
export function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  // A number is text a person would recognise, and a stored `0` or `2024` is
  // almost always a value someone typed. Booleans, objects and null are not.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
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
