import type { AuthUser } from "../../types/auth";

import type { AuthOutcome, AuthStrategy } from "./types";

export interface PasswordStrategyDeps {
  /**
   * Wraps the existing credential verification. Throws a `NextlyError` on every
   * failure leg (bad password / locked / unverified / inactive) — exactly as the
   * legacy login path did — and returns the user on success.
   *
   * `passwordUpdatedAt`, when returned, is when the proven password was set; it
   * is kept off the user the strategy hands on, and read back with
   * {@link provenPasswordVersion}.
   */
  verify: (creds: {
    email: string;
    password: string;
  }) => Promise<AuthUser & { passwordUpdatedAt?: Date | null }>;
}

/**
 * When the password each authenticated user proved was set, keyed by the user
 * object the strategy returned.
 *
 * Held beside the user rather than on it: the user is handed to plugin hooks,
 * and the outcome type is plugin-facing, while this value is only for the
 * login handler. Keyed weakly, so an entry lives as long as its login does.
 */
const provenPasswordVersions = new WeakMap<AuthUser, Date | null>();

/**
 * When the password `user` proved was set, if the built-in password strategy
 * authenticated it; `undefined` for a user any other strategy returned.
 *
 * The login handler carries this into the session it issues, which is refused
 * if the account's password was set again before the session's refresh row is
 * written: a password reset while the proof was being checked must not leave
 * the old password's holder signed in.
 */
export function provenPasswordVersion(user: AuthUser): Date | null | undefined {
  return provenPasswordVersions.get(user);
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
      const { passwordUpdatedAt, ...user } = await deps.verify({
        email,
        password,
      });
      if (passwordUpdatedAt !== undefined) {
        provenPasswordVersions.set(user, passwordUpdatedAt);
      }
      return { type: "authenticated", user };
    },
  };
}
