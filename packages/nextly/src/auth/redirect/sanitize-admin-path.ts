/**
 * Where a login lands when the caller asked for nowhere in particular.
 *
 * The admin root rather than the login page, so a user who arrives at a
 * sign-in route directly still ends up somewhere useful.
 *
 * @module auth/redirect/sanitize-admin-path
 * @since 1.0.0
 */
export const DEFAULT_ADMIN_PATH = "/admin";

/**
 * Reduce a caller-supplied destination to a safe same-origin admin path.
 *
 * An endpoint that echoes an arbitrary destination back into a redirect is an
 * open redirect, and an open redirect on a login route is worth more to an
 * attacker than on any other: it lends the site's own domain to a phishing
 * page reached immediately after a real login prompt.
 *
 * Allowing only a path — never a URL — is what makes this decidable. A filter
 * that tries to recognise hostile absolute URLs has to keep pace with every
 * encoding a browser will accept (`//evil.com`, `/\evil.com`, `https:/\evil`,
 * percent-encoded separators, a `javascript:` scheme, a backslash Windows and
 * some parsers fold to a slash). Requiring a single leading `/` followed by a
 * character that cannot begin an authority rejects all of them by
 * construction, including the ones not yet invented.
 *
 * The result must also be inside the admin panel, which is the only place a
 * finished login belongs. `/adminx` is a different path than `/admin` and is
 * refused; `/admin` and `/admin/...` are kept.
 *
 * Anything rejected returns {@link DEFAULT_ADMIN_PATH} rather than raising: a
 * bad destination is a reason to ignore it, not a reason to fail a login the
 * user legitimately started.
 */
export function sanitizeAdminPath(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) return DEFAULT_ADMIN_PATH;

  // Decode once before inspecting, so a percent-encoded separator is judged as
  // the character it becomes rather than as the literal `%2f`. A malformed
  // sequence throws, and a destination that is not valid percent-encoding is
  // not one worth recovering.
  let candidate: string;
  try {
    candidate = decodeURIComponent(next);
  } catch {
    return DEFAULT_ADMIN_PATH;
  }

  // A control character (NUL, CR, LF, tab, DEL) can truncate a Location header
  // or split it into a second one. Nothing legitimate carries one.
  //
  // Compared by code point rather than matched by pattern: a literal control
  // character inside a regular expression is invisible in review and easily
  // lost to an editor or a copy, and the comparison says what it means.
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return DEFAULT_ADMIN_PATH;
  }

  // Must be a rooted path.
  if (!candidate.startsWith("/")) return DEFAULT_ADMIN_PATH;

  // `//host` and `/\host` are both authority-relative: the browser reads them
  // as another origin, so neither is a path however much it looks like one.
  if (candidate.length > 1) {
    const second = candidate[1];
    if (second === "/" || second === "\\") return DEFAULT_ADMIN_PATH;
  }

  // NORMALIZED before it is judged, by the same parser that will interpret it.
  // One `decodeURIComponent` is not normalization: `/admin/%252e%252e/public`
  // becomes `/admin/%2e%2e/public`, which passes a prefix test and is then
  // resolved by the browser to `/public` — outside the admin panel this
  // function exists to keep it inside. The URL parser resolves `.`, `..` and
  // their percent-encoded spellings, so asking it removes the whole class
  // rather than the one encoding that was noticed.
  //
  // The base is a placeholder: `candidate` is already known to be a rooted
  // path and not authority-relative, so nothing here can reach another origin.
  let parsed: URL;
  try {
    parsed = new URL(candidate, "http://nextly.invalid");
  } catch {
    return DEFAULT_ADMIN_PATH;
  }

  // Judged on the path alone so a query or fragment cannot smuggle the
  // decision. `/adminx` shares a prefix with `/admin` and is a different place
  // entirely.
  const path = parsed.pathname;
  if (
    path !== DEFAULT_ADMIN_PATH &&
    !path.startsWith(`${DEFAULT_ADMIN_PATH}/`)
  ) {
    return DEFAULT_ADMIN_PATH;
  }

  // The normalized form, not the input: returning the original would hand the
  // browser a string it still has to resolve, which is where the gap was.
  return `${path}${parsed.search}${parsed.hash}`;
}
