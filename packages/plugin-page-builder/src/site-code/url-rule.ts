/**
 * The URL rule site code and custom CSS share, and what ends a style element.
 *
 * A module of its own, loading no CSS parser, so the custom CSS checker can run
 * in the browser for the CSS boxes' early feedback and still hold a URL to the
 * same rule the server does.
 *
 * @module site-code/url-rule
 */
import { SITE_CODE_LIMITS } from "./limits";

/**
 * What ends a style element early, wherever author text is drawn inside one:
 * the HTML parser closes it at `</style`, whatever follows.
 */
export const STYLE_ELEMENT_END: RegExp = /<\/style/i;

/**
 * A URL with what browsers ignore before reading it taken out: ASCII
 * whitespace and control characters (U+0000 to U+0020, U+007F to U+009F),
 * which is how `java\tscript:` still runs. Read by code point, so no
 * pattern has to spell control characters.
 */
function withoutIgnored(value: string): string {
  let read = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    read += char;
  }
  return read;
}

/**
 * Why a URL may not be used, or `undefined` when it may: it must be `https:`
 * or a path on this site (`/…`), read as a browser reads it once what it
 * ignores is taken out, so no obfuscation of another scheme gets through.
 */
export function siteCodeUrlProblem(value: string): string | undefined {
  if (value.length > SITE_CODE_LIMITS.urlLength) {
    return `is longer than ${SITE_CODE_LIMITS.urlLength} characters`;
  }
  const read = withoutIgnored(value);
  // A path on this site, but not `//host` or `/\host`, which browsers read
  // as another host.
  if (read.startsWith("/")) {
    return read.startsWith("//") || read.includes("\\")
      ? "points at another site without saying https:"
      : undefined;
  }
  let url: URL;
  try {
    url = new URL(read);
  } catch {
    return "is not an https: address or a path on this site";
  }
  return url.protocol === "https:"
    ? undefined
    : `uses ${url.protocol}, and only https: addresses are allowed`;
}
