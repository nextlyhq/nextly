// PR 5 (unified-error-system): security-hardening pass for the login flow.
//
// What changed and why:
//   1. Throws NextlyError on every failure path instead of returning a Result
//      shape. Account-state codes (locked / unverified / inactive) collapse
//      into the single AUTH_INVALID_CREDENTIALS public response per spec
//      §13.1 — they used to leak account state to the wire. Internal context
//      (the actual "reason") is preserved in logContext for operators.
//   2. bcrypt compare now runs on every request, even when the user lookup
//      misses, by hashing the supplied password against a stable decoy hash.
//      This eliminates the timing side-channel that previously let attackers
//      enumerate registered emails by measuring response latency.
//   3. The exported helpers are pure throw-on-error functions; callers no
//      longer pattern-match a result tuple. handleLogin catches NextlyError
//      and serialises via toResponseJSON (same shape as withErrorHandler).
import { NextlyError } from "../../errors/nextly-error";
import { verifyPassword } from "../password/index";

export interface CredentialVerifyInput {
  email: string;
  password: string;
}

export interface VerifiedUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: Date | null;
  isActive: boolean;
}

/**
 * Stable decoy bcrypt hash used to keep timing constant when the lookup
 * misses. Generated once locally with bcryptjs at cost 12 and baked in —
 * MUST NOT be rotated. Rotating it would change the time bcrypt.compare
 * spends on the miss path (different cost or salt re-tuning) and re-open
 * the timing side-channel this constant exists to close.
 */
const DUMMY_HASH =
  "$2b$12$ML1pr5W9k0ODLs2GFo9gruB/VcQfuby0nAeFo959eFXl0u1ZUmbb6";

/**
 * Verify email + password credentials.
 *
 * Behaviour (per spec §13.1):
 *   - Always runs `bcrypt.compare` exactly once, even when the user is
 *     missing, so the response time does not depend on whether the email
 *     is registered.
 *   - Throws `NextlyError.invalidCredentials()` for every failure leg
 *     (missing user, wrong password, locked, unverified, inactive). The
 *     wire response is identical; logContext records the real cause.
 *   - Returns `VerifiedUser` on success.
 *
 * Failed-attempt tracking and account locking still happen as side-effects
 * inside the wrong-password leg — same lock-out semantics as before, just
 * surfaced as a generic invalid-credentials response instead of a distinct
 * 429.
 */
export async function verifyCredentials(
  input: CredentialVerifyInput,
  deps: {
    findUserByEmail: (email: string) => Promise<{
      id: string;
      email: string;
      name: string;
      image: string | null;
      passwordHash: string;
      emailVerified: Date | null;
      isActive: boolean;
      failedLoginAttempts: number;
      lockedUntil: Date | null;
    } | null>;
    incrementFailedAttempts: (userId: string) => Promise<void>;
    lockAccount: (userId: string, lockedUntil: Date) => Promise<void>;
    resetFailedAttempts: (userId: string) => Promise<void>;
    maxLoginAttempts: number;
    lockoutDurationSeconds: number;
    requireEmailVerification: boolean;
  }
): Promise<VerifiedUser> {
  const user = await deps.findUserByEmail(input.email);

  // Timing equalisation: always run bcrypt compare exactly once, regardless
  // of whether we found a user. Without this branch, the miss path returns
  // immediately and an attacker can enumerate registered emails via timing.
  const passwordOk = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyPassword(input.password, DUMMY_HASH);

  if (!user || !passwordOk) {
    if (user) {
      // Track failed attempts and lock the account once the threshold trips.
      // This is independent of the public response — locking still happens
      // even though the wire shape is identical to a wrong-password reply.
      const newAttempts = user.failedLoginAttempts + 1;
      if (newAttempts >= deps.maxLoginAttempts) {
        const lockedUntil = new Date(
          Date.now() + deps.lockoutDurationSeconds * 1000
        );
        await deps.lockAccount(user.id, lockedUntil);
      } else {
        await deps.incrementFailedAttempts(user.id);
      }
    }
    throw NextlyError.invalidCredentials({
      logContext: {
        email: input.email,
        reason: !user ? "user-not-found" : "password-mismatch",
      },
    });
  }

  // Account-state checks happen AFTER the password check so they cannot be
  // used as an enumeration side-channel either. All three paths throw the
  // same public error; only the internal logContext distinguishes them.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw NextlyError.invalidCredentials({
      logContext: {
        userId: user.id,
        reason: "locked",
        lockedUntil: user.lockedUntil,
      },
    });
  }
  if (deps.requireEmailVerification && !user.emailVerified) {
    throw NextlyError.invalidCredentials({
      logContext: { userId: user.id, reason: "unverified" },
    });
  }
  if (!user.isActive) {
    throw NextlyError.invalidCredentials({
      logContext: { userId: user.id, reason: "inactive" },
    });
  }

  if (user.failedLoginAttempts > 0) {
    await deps.resetFailedAttempts(user.id);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
  };
}
