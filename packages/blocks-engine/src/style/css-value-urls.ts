/**
 * URLs inside a value: the text of an unquoted `url()`, the walk that
 * finds a URL nested in any function, and the check a URL itself gets.
 *
 * @module style/css-value-urls
 */
import type { CssNode } from "css-tree";

// Shared with the URL policy rather than spelled again here. A control
// character is refused for one reason in both places — it survives no round
// trip through a stylesheet or an attribute intact — and two copies of that
// character set would drift into a value one layer accepts and the next
// rejects.
import { hasControlCharacter } from "../url-policy";

import {
  asciiLower,
  decodeIdentifier,
  identifierOf,
  parseValue,
  URL_STRING_FUNCTIONS,
} from "./css-value-syntax";
import {
  ALLOWED_URL_SCHEMES,
  type CssValueRejection,
  MAX_VALUE_LENGTH,
  MAX_VALUE_NESTING,
  type MayFetchUrl,
  UNSAFE_QUOTED_URL_CHARS,
  UNSAFE_URL_CHARS,
  URL_SCHEME,
} from "./css-value-vocabulary";

/**
 * The text of an unquoted `url()` argument, with its escapes resolved.
 *
 * An escaped function name never becomes a `Url` node, so an escaped
 * `url(data\3a …)` arrives as a function whose argument is a run of ordinary
 * tokens rather than a string, and the colon that makes it a scheme is hidden
 * inside an identifier. Rendering the tokens back is what lets the scheme
 * check see what the browser will see.
 *
 * `null` means the argument held something this cannot render, which on this
 * path is answered by refusing rather than by guessing.
 */
function unquotedUrlText(children: Iterable<CssNode>): string | null {
  let text = "";
  for (const child of children) {
    switch (child.type) {
      case "Identifier":
        text += decodeIdentifier(child.name);
        break;
      case "Operator":
        text += child.value;
        break;
      case "String":
        text += child.value;
        break;
      case "Number":
        text += String(child.value);
        break;
      case "Dimension":
        text += `${String(child.value)}${decodeIdentifier(child.unit)}`;
        break;
      case "Percentage":
        text += `${String(child.value)}%`;
        break;
      case "Hash":
        text += `#${decodeIdentifier(child.value)}`;
        break;
      default:
        return null;
    }
  }
  return text;
}

/**
 * The first refused URL anywhere in a parsed value, or `null`.
 *
 * The walk is recursive, so it is wrapped: the depth cap ahead of it is what
 * keeps the recursion bounded, and if a value ever gets past that cap the
 * honest answer is to refuse it rather than let an exception escape a
 * validator. Failing closed costs a value that was already at the limit; the
 * alternative turns a document write into a server error.
 */
export function nestedUrlRejection(
  ast: CssNode,
  mayFetchUrl: MayFetchUrl | undefined
): CssValueRejection | null {
  try {
    return walkForUrlRejection(ast, mayFetchUrl);
  } catch {
    return "too-deeply-nested";
  }
}

// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
function walkForUrlRejection(
  node: CssNode,
  // Before the two defaulted parameters on purpose: a caller that slots an
  // argument wrongly gets a type error rather than a predicate silently dropped,
  // which would leave every URL in the value unasked about.
  mayFetchUrl: MayFetchUrl | undefined,
  urlContext = false,
  depth = 0
): CssValueRejection | null {
  switch (node.type) {
    case "Url":
      return checkUrlValue(node.value, "quoted", mayFetchUrl);
    case "String":
      // A quoted string is a URL only where the function around it loads one.
      // The same string is a font family somewhere else, so the surrounding
      // context decides, not the node.
      return urlContext
        ? checkUrlValue(node.value, "quoted", mayFetchUrl)
        : null;
    case "Raw": {
      // A custom property's fallback is kept unparsed, so it has to be read
      // back or `var(--x, url("javascript:…"))` reaches the page whenever the
      // property is absent. It is read back IN CONTEXT: an unset property
      // hands its fallback straight to the function around it, so a bare
      // string there is loaded exactly as a written-out one would be.
      // Bounded by the same depth cap the bracket count enforces, so a
      // fallback inside a fallback cannot recurse without end.
      if (depth >= MAX_VALUE_NESTING) return null;
      const parsed = parseValue(node.value);
      return parsed === null
        ? null
        : walkForUrlRejection(parsed, mayFetchUrl, urlContext, depth + 1);
    }
    default:
      break;
  }
  if (!("children" in node) || node.children === null) return null;
  let inner = urlContext;
  if (node.type === "Function") {
    const name = identifierOf(node);
    if (URL_STRING_FUNCTIONS.has(name)) {
      inner = true;
      // Only `url()` takes an unquoted argument, and only by an escaped
      // spelling does one reach here as a function: a run of tokens rather
      // than a string, with the colon that names the scheme hidden inside an
      // identifier. The image functions take a string or a nested `url()`,
      // both of which the recursion already reaches.
      if (name === "url" && !hasStringChild(node.children)) {
        const text = unquotedUrlText(node.children);
        return text === null
          ? "unsafe-url-characters"
          : checkUrlValue(text, "raw", mayFetchUrl);
      }
    } else if (name !== "var" && name !== "env") {
      // A reference passes its context through to whatever stands in for it;
      // every other function establishes its own, and a string inside one is
      // not a URL because it sits inside something that is.
      inner = false;
    }
  }
  for (const child of node.children) {
    const rejection = walkForUrlRejection(child, mayFetchUrl, inner, depth);
    if (rejection !== null) return rejection;
  }
  return null;
}

function hasStringChild(children: Iterable<CssNode>): boolean {
  for (const child of children) {
    if (child.type === "String") return true;
  }
  return false;
}

/**
 * Where a URL was read from, which decides what can still break out of it.
 * `raw` is a stored value that will be wrapped in `url(...)` on the way out;
 * `quoted` is one the parser has already delimited for us.
 */
type UrlContext = "raw" | "quoted";

/**
 * Check a URL destined for `url()`. Returns `null` when it is safe to emit.
 */
export function checkUrlValue(
  value: string,
  context: UrlContext = "raw",
  // Which hosts this site will fetch from, when the caller has an answer. A
  // string is passed rather than a parsed URL because the emitted declaration
  // carries the string, and re-serialising a parse would let the two differ.
  mayFetchUrl?: MayFetchUrl
): CssValueRejection | null {
  // A dedicated URL property does not pass through the free-form value check,
  // so without this its own cap is the document byte limit: one stored value
  // could otherwise emit a megabyte-long declaration and request. Checked
  // first, before anything scans the string.
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (value.trim() === "") return "unsafe-url-scheme";
  // Control characters come first: they are what would let a scheme hide from
  // the check below while a browser still reads it.
  if (hasControlCharacter(value)) return "unsafe-url-characters";
  // The scheme is checked first because a refused scheme is the more useful
  // thing to tell an author, and a hostile URL usually trips both guards.
  const scheme = URL_SCHEME.exec(value);
  if (scheme !== null) {
    const matched = scheme[1];
    const name = matched === undefined ? undefined : asciiLower(matched);
    if (name === undefined || !ALLOWED_URL_SCHEMES.includes(name)) {
      return "unsafe-url-scheme";
    }
  }
  // Checked against the raw value, not a trimmed copy: trimming first would
  // quietly discard a trailing newline rather than refuse it, and the value
  // emitted is the one stored, not the trimmed one.
  const unsafe =
    context === "quoted" ? UNSAFE_QUOTED_URL_CHARS : UNSAFE_URL_CHARS;
  if (unsafe.test(value)) return "unsafe-url-characters";
  // Asked LAST, of a value already known to be well formed, so the host rule is
  // never the reason given for a value that was going to be refused anyway. A
  // caller with no host policy leaves this undefined and nothing changes: the
  // scheme allowlist above is then the only limit, which is what every caller
  // outside a configured site gets today.
  if (mayFetchUrl !== undefined && !mayFetchUrl(value)) {
    return "url-host-not-allowed";
  }
  return null;
}
