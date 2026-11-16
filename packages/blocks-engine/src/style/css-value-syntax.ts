/**
 * Reading a CSS value's text: CSS whitespace and tokens, ASCII case,
 * CSS-wide keywords, function arguments, escaped identifiers, and the
 * parse every check starts from.
 *
 * @module style/css-value-syntax
 */
import type { CssNode } from "css-tree";
import parse from "css-tree/parser";

import { CSS_WIDE_KEYWORDS } from "./css-value-vocabulary";

/** Split a function's children on its top-level commas. */
export function splitArguments(children: Iterable<CssNode>): CssNode[][] {
  const args: CssNode[][] = [[]];
  for (const child of children) {
    // Only a comma separates arguments. An arithmetic operator carries its
    // surrounding whitespace in the same node, which is why this compares the
    // trimmed text rather than the raw value.
    if (child.type === "Operator" && child.value.trim() === ",") {
      args.push([]);
      continue;
    }
    args[args.length - 1]?.push(child);
  }
  return args;
}

/**
 * CSS whitespace, which is narrower than JavaScript's `\s`: that also matches
 * NO-BREAK SPACE and the Unicode spaces, and the CSS parser does not. It keeps
 * those inside the identifier, so `block\u00a0` is a single token the browser
 * discards rather than `block` with something trimmable after it. Normalising
 * with `\s` would therefore accept a value that never renders.
 */
const CSS_WHITESPACE_EDGES = /^[ \t\r\n\f]+|[ \t\r\n\f]+$/g;

/** A value with only CSS whitespace removed from either end. */
export function trimCssWhitespace(value: string): string {
  return value.replace(CSS_WHITESPACE_EDGES, "");
}

/** One CSS escape: a hex sequence with its optional terminator, or a literal. */
const CSS_ESCAPE = /^\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[ \t\r\n\f])?|[\s\S])/;

/**
 * Split a value into the tokens CSS reads, leaving escapes intact.
 *
 * Decoding before splitting turns an escaped space into a separator, so
 * `hidden\ auto` reads as two keywords when it is one identifier containing a
 * space — a value the browser discards. Splitting first and decoding each token
 * keeps the boundary where CSS puts it.
 */
export function splitCssTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      const escape = CSS_ESCAPE.exec(value.slice(index))?.[0] ?? "\\";
      current += escape;
      index += escape.length - 1;
      continue;
    }
    if (character !== undefined && " \t\r\n\f".includes(character)) {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    current += character ?? "";
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

/**
 * Lowercase the ASCII letters and nothing else.
 *
 * CSS folds identifier case for A–Z only, while JavaScript's `toLowerCase` is
 * Unicode-aware and maps U+212A KELVIN SIGN to `k`. Folding with it would match
 * `blocK` against `block` here while the browser keeps them distinct
 * identifiers and discards the declaration, so every identifier comparison in
 * `css-value` and the validator uses this instead.
 */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, letter => letter.toLowerCase());
}

/** True when a value is one of the keywords legal on every CSS property. */
export function isCssWideKeyword(value: string): boolean {
  return CSS_WIDE_KEYWORDS.has(asciiLower(value));
}

/** Parse a CSS value, or `null` when it is not one. */
export function parseValue(value: string): CssNode | null {
  try {
    return parse(value, {
      context: "value",
      onParseError: error => {
        throw error;
      },
    });
  } catch {
    return null;
  }
}

/**
 * Functions that take a URL as a plain string rather than inside `url()`.
 * An image source is `<url> | <string>`, so `image("a.png")` and
 * `image-set("a.png" 1x)` both load that string as an image and need the same
 * scheme allowlist, even though the parser gives them no `Url` node.
 */
export const URL_STRING_FUNCTIONS: ReadonlySet<string> = new Set([
  // An escaped spelling never becomes a `Url` node — css-tree only recognises
  // the literal one — so `u\72l("…")` arrives as an ordinary function and
  // needs the same treatment its unescaped twin gets for free.
  "url",
  "image",
  "image-set",
  "-webkit-image-set",
  "src",
]);

/**
 * A CSS identifier with its escapes resolved.
 *
 * css-tree leaves escapes in a function's NAME even though it decodes them in a
 * url's value, so `u\72l(...)` arrives here spelled that way while the browser
 * reads it as `url(...)`. Classifying on the raw spelling therefore skips every
 * check that depends on knowing which function this is, including the scheme
 * allowlist.
 *
 * A code point outside the Unicode range becomes the replacement character, as
 * the CSS syntax specification requires, rather than throwing.
 */
/**
 * One string written as a CSS identifier, escaping whatever cannot appear raw.
 *
 * The inverse of {@link decodeIdentifier}, and the same algorithm the DOM
 * exposes as `CSS.escape` — implemented here because this package imports no
 * framework and `CSS` is a browser global, and because a stylesheet compiled on
 * a server has to escape exactly as the browser would parse.
 *
 * Written out rather than approximated with a "safe characters only" test. A
 * class attribute may hold a token the CSS grammar cannot spell raw — a UUID
 * beginning with a digit, `_region`, `-region` — and refusing those means
 * refusing valid input, while passing them through unescaped emits a selector
 * that silently matches something else or nothing.
 *
 * Follows CSSOM's "serialize an identifier": a leading digit, and a digit after
 * a leading dash, are written as a hex escape, because `.1a` and `.-1a` are not
 * identifiers at all; a lone dash is escaped for the same reason. Control
 * characters become hex escapes, NULL becomes the replacement character, and
 * everything from U+0080 up is left alone, since CSS identifiers admit it.
 */
// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
export function escapeIdentifier(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const char = value[index];
    if (code === 0) {
      out += "\uFFFD";
      continue;
    }
    if (
      (code >= 0x1 && code <= 0x1f) ||
      code === 0x7f ||
      (index === 0 && code >= 0x30 && code <= 0x39) ||
      (index === 1 &&
        code >= 0x30 &&
        code <= 0x39 &&
        value.charCodeAt(0) === 0x2d)
    ) {
      out += `\\${code.toString(16)} `;
      continue;
    }
    if (index === 0 && code === 0x2d && value.length === 1) {
      out += `\\${char}`;
      continue;
    }
    if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      out += char;
      continue;
    }
    out += `\\${char}`;
  }
  return out;
}

export function decodeIdentifier(name: string): string {
  if (!name.includes("\\")) return name;
  return name.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|([\s\S]))/g,
    (_match: string, hex?: string, literal?: string) => {
      if (hex === undefined) return literal ?? "";
      const point = Number.parseInt(hex, 16);
      const usable =
        point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff);
      return usable ? String.fromCodePoint(point) : "\uFFFD";
    }
  );
}

/** An identifier as CSS reads it, folded for comparison. */
export function identifierOf(node: { name: string }): string {
  return asciiLower(decodeIdentifier(node.name));
}

/**
 * Whether a `var()` or `env()` carries the name it exists to reference.
 *
 * The fallback stays unread — what a custom property resolves to is not
 * knowable here — but the head is not optional: `var()` names a custom property
 * and `env()` an environment variable, so a reference with no name resolves to
 * nothing and the browser discards the declaration around it. A custom property
 * name is case-sensitive, so only the leading dashes are read and the spelling
 * is left alone.
 *
 * One function for every leaf that accepts these, because a rule about what a
 * reference must carry is the same rule whether a length or a colour is being
 * referenced.
 */
export function referenceNamesSomething(node: {
  name: string;
  children: Iterable<CssNode>;
}): boolean {
  const head = splitArguments(node.children)[0] ?? [];
  const named = head[0];
  if (named?.type !== "Identifier") return false;
  if (identifierOf(node) === "var") {
    // Only the name is read here. A `var()` head carrying anything besides it
    // does not parse at all, so there is nothing left for this to refuse.
    return decodeIdentifier(named.name).startsWith("--");
  }
  // An environment variable is named by a custom identifier, which excludes
  // the CSS-wide keywords: `env(inherit)` names nothing, because `inherit` is
  // never an identifier a value can carry.
  if (!isCustomIdentifier(identifierOf(named))) return false;
  // `env()` may index into the variable it names, and an index is a
  // non-negative integer: `env(titlebar-area-x 1)` reads the second value.
  // Anything else in the head makes the reference resolve to nothing.
  return head.slice(1).every(isIndex);
}

/**
 * Whether a name is a `<custom-ident>`: an author-chosen identifier. The
 * CSS-wide keywords are excluded because they are whole values wherever they
 * appear, and `default` is reserved alongside them.
 */
function isCustomIdentifier(name: string): boolean {
  return !CSS_WIDE_KEYWORDS.has(name) && name !== "default";
}

/** Whether a node is a non-negative integer, which is what indexes a value. */
function isIndex(node: CssNode): boolean {
  // An explicit `+` is valid integer syntax, so the spelling is not the test:
  // `env(viewport-segment-width +1 0)` is a reference the browser resolves. A
  // decimal point is not an integer, which is why this is not a numeric parse.
  return node.type === "Number" && /^\+?\d+$/.test(node.value);
}

/**
 * A dimension's unit as CSS reads it. Units are identifiers, so they carry
 * escapes like any other: `1p\78` is `1px`, and comparing the raw spelling
 * against the unit sets refuses a measurement the browser accepts.
 */
export function unitOf(node: { unit: string }): string {
  return asciiLower(decodeIdentifier(node.unit));
}
