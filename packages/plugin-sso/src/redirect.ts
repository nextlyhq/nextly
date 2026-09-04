/**
 * Where a login lands when the caller asked for nowhere in particular.
 *
 * The admin root rather than the login page, so a user who arrives at
 * `/authorize` directly still ends up somewhere useful.
 */
export const DEFAULT_NEXT = "/admin";

/**
 * Reduce a caller-supplied `next` to a safe same-origin path.
 *
 * An authorization endpoint that echoes an arbitrary destination back into a
 * redirect is an open redirect, and an open redirect on a login route is worth
 * more to an attacker than on any other: it lends the site's own domain to a
 * phishing page reached immediately after a real login prompt.
 *
 * Allowing only a path — never a URL — is what makes this decidable. A filter
 * that tries to recognise hostile absolute URLs has to keep pace with every
 * encoding a browser will accept (`//evil.com`, `/\evil.com`, `https:/\evil`,
 * percent-encoded separators, a `javascript:` scheme, a backslash Windows and
 * some parsers fold to a slash). Requiring a single leading `/` followed by a
 * character that cannot begin an authority rejects all of them by construction,
 * including the ones not yet invented.
 *
 * Anything rejected returns {@link DEFAULT_NEXT} rather than raising: a bad
 * `next` is a reason to ignore it, not a reason to fail a login the user
 * legitimately started.
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) return DEFAULT_NEXT;

  // Decode once before inspecting, so a percent-encoded separator is judged as
  // the character it becomes rather than as the literal `%2f`. A malformed
  // sequence throws, and a `next` that is not valid percent-encoding is not one
  // worth recovering.
  let candidate: string;
  try {
    candidate = decodeURIComponent(next);
  } catch {
    return DEFAULT_NEXT;
  }

  // A control character (NUL, CR, LF, tab, DEL) can truncate a Location header
  // or split it into a second one. Nothing legitimate carries one.
  //
  // Compared by code point rather than matched by pattern: a literal control
  // character inside a regular expression is invisible in review and easily
  // lost to an editor or a copy, and the comparison says what it means.
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return DEFAULT_NEXT;
  }

  // Must be a rooted path.
  if (!candidate.startsWith("/")) return DEFAULT_NEXT;

  // `//host` and `/\host` are both authority-relative: the browser reads them
  // as another origin, so neither is a path however much it looks like one.
  if (candidate.length > 1) {
    const second = candidate[1];
    if (second === "/" || second === "\\") return DEFAULT_NEXT;
  }

  return candidate;
}
