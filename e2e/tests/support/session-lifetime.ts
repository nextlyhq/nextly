/**
 * When a cached session must be replaced, read from the session's own token.
 *
 * Both of a session's cookies live as long as its refresh token, so a cookie's
 * expiry says nothing about the access token inside it. The token's claims do:
 * `iat` and `exp` give its real lifetime, whatever the server's setting is.
 *
 * Replaced once two thirds of that lifetime have gone, which on the 15-minute
 * token is ten minutes and leaves five, the longest a spec lets one test run.
 * Replaced by signing in again and never by a refresh: a refresh rotates the
 * refresh token every other context holding this session was handed.
 *
 * @module tests/support/session-lifetime
 */

/** The share of a token's lifetime it may spend before it is replaced. */
const RENEW_AFTER_SPENT = 2 / 3;

/**
 * Whether `cookies` hold a session that should be replaced at `now`: its
 * access token is missing or unreadable, or has spent its share of its life.
 *
 * @param cookies - A session's cookies, as a storage state or context holds them.
 * @param now - The time to judge at, in milliseconds.
 */
export function sessionNeedsRenewal(
  cookies: ReadonlyArray<{ name: string; value: string }>,
  now: number
): boolean {
  const token = cookies.find(cookie => cookie.name === "nextly_session")?.value;
  const payload = token?.split(".")[1];
  if (payload === undefined) return true;
  let claims: { iat?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as typeof claims;
  } catch {
    return true;
  }
  const { iat, exp } = claims;
  if (typeof iat !== "number" || typeof exp !== "number") return true;
  return now >= (iat + (exp - iat) * RENEW_AFTER_SPENT) * 1000;
}
