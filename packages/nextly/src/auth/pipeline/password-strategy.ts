import type { AuthUser } from "../../types/auth";

import type { AuthOutcome, AuthStrategy } from "./types";

export interface PasswordStrategyDeps {
  /**
   * Wraps the existing credential verification. Throws a `NextlyError` on every
   * failure leg (bad password / locked / unverified / inactive) — exactly as the
   * legacy login path did — and returns the user on success.
   */
  verify: (creds: { email: string; password: string }) => Promise<AuthUser>;
}

/**
 * @experimental The built-in `password` strategy. Returns `pass` when the request
 * carries no email/password (so another strategy can claim it), `authenticated`
 * on success, and re-throws the verifier's `NextlyError` on failure so the login
 * handler keeps the unified error wire shape + stall + audit (D71).
 */
export function createPasswordStrategy(
  deps: PasswordStrategyDeps
): AuthStrategy {
  return {
    name: "password",
    async authenticate(input): Promise<AuthOutcome> {
      const { email, password } = input.body;
      if (typeof email !== "string" || typeof password !== "string") {
        return { type: "pass" };
      }
      const user = await deps.verify({ email, password });
      return { type: "authenticated", user };
    },
  };
}
