import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";
import { verifyPassword } from "../password/index";
import { assertAccountUsable } from "../session/account-state";

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
  /** True when the account still holds an admin-set password to replace. */
  mustChangePassword: boolean;
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
 * Failed-attempt tracking and account locking happen as side-effects
 * inside the wrong-password leg, surfaced as a generic invalid-credentials
 * response.
 */
export async function verifyCredentials(
  input: CredentialVerifyInput,
  deps: {
    findUserByEmail: (email: string) => Promise<{
      id: string;
      email: string;
      name: string;
      image: string | null;
      /**
       * NULLABLE, because an account can exist without one: a user created
       * through an external identity provider is stored with no password at
       * all. Declared as `string` here while the column was nullable, which
       * is how the passwordless case reached `verifyPassword` unexamined.
       */
      passwordHash: string | null;
      emailVerified: Date | null;
      isActive: boolean;
      mustChangePassword: boolean | null;
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

  // Timing equalisation: always run bcrypt compare exactly once, against a
  // REAL cost-12 hash. Without it the miss path returns immediately and an
  // attacker can enumerate registered emails via timing.
  //
  // The decoy stands in for an account that HAS no password as well as for
  // one that does not exist. `verifyPassword` returns on the spot when the
  // stored hash is empty, so an externally-authenticated account — created
  // with a null hash — answered a password attempt faster than an unknown
  // address did. That is the enumeration oracle again, and a sharper one:
  // it does not merely say an address is registered, it says the address
  // signs in through the identity provider, which is the account whose
  // password can never be the thing that stops an attacker.
  const storedHash = user?.passwordHash;
  const compared = await verifyPassword(
    input.password,
    storedHash || DUMMY_HASH
  );
  // A passwordless account can never be admitted BY a password, whatever the
  // comparison against the decoy answered.
  const passwordOk = Boolean(storedHash) && compared;

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
        reason: auditReason(!user ? "user-not-found" : "password-mismatch"),
      },
    });
  }

  // Account-state checks happen AFTER the password check so they cannot be
  // used as an enumeration side-channel either. All three paths throw the
  // same public error; only the internal logContext distinguishes them.
  //
  // The decision itself lives in the shared gate, which every session-issuing
  // path calls, so the password path cannot drift from the rest.
  assertAccountUsable(
    {
      userId: user.id,
      isActive: user.isActive,
      lockedUntil: user.lockedUntil,
      emailVerified: user.emailVerified,
    },
    {
      requireEmailVerification: deps.requireEmailVerification,
      // This IS the password strategy, so the attempt lockout applies.
      enforcePasswordLockout: true,
    }
  );

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
    mustChangePassword: user.mustChangePassword ?? false,
  };
}
