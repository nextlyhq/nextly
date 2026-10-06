/**
 * The cookies a newly issued session sets, for every path that issues one:
 * sign-in, rotation, first-run setup and the development auto-login.
 *
 * @module auth/cookies/session-cookies
 * @since 1.0.0
 */
import { setAccessTokenCookie } from "./access-token-cookie";
import { setRefreshTokenCookies } from "./refresh-token-cookie";

/**
 * The Set-Cookie headers for a session: its access token and its refresh
 * token.
 *
 * Both cookies live for the refresh token's lifetime. The access token's own
 * `exp` claim still ends it after the access-token lifetime; the cookie
 * outlives it so an expired token keeps reaching the server, which answers
 * `TOKEN_EXPIRED` and so starts a refresh rather than a new sign-in.
 */
export function sessionCookies(
  accessToken: string,
  refreshToken: string,
  opts: { refreshTokenTTL: number; isProduction: boolean }
): string[] {
  return [
    setAccessTokenCookie(accessToken, opts.refreshTokenTTL, opts.isProduction),
    ...setRefreshTokenCookies(
      refreshToken,
      opts.refreshTokenTTL,
      opts.isProduction
    ),
  ];
}
