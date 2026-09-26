/**
 * The single answer to "may this account hold a session right now?".
 *
 * Every path that ends in a session — password login, challenge resolution,
 * forced password change, refresh, and a plugin finishing an external login —
 * asks this function, so no strategy can mint a session for an account the
 * password path would refuse. Previously each handler re-checked whichever
 * parts of the account state it remembered, and a path that forgot one simply
 * issued the session.
 *
 * The public error is identical for every refusal; only the log context names
 * the reason, so the gate cannot be used to tell a locked account from an
 * unknown one.
 *
 * @module auth/session/account-state
 * @since 1.0.0
 */
import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";

/** The account facts the gate decides on, as stored on the user row. */
export interface AccountState {
  userId: string;
  isActive: boolean;
  lockedUntil: Date | null;
  emailVerified: Date | null;
  /**
   * Whether the account still holds an admin-set password it must replace.
   * Read from the ROW by whoever makes the forced-change decision: a
   * hook-modified user object may drop the field, and trusting that copy
   * let a benign profile-transforming hook skip the forced change.
   */
  mustChangePassword?: boolean | null;
}

export interface AccountGateOptions {
  /** Whether an unverified email blocks sign-in, mirroring the password path. */
  requireEmailVerification: boolean;
  /**
   * Whether the password-attempt lockout applies. It does for the password
   * strategy; it does NOT for an external login or a refresh, because
   * otherwise anyone who knows an email could lock its owner out of SSO with
   * five wrong passwords — a denial of service, not a defence.
   */
  enforcePasswordLockout: boolean;
  /** Overridable so the lock comparison is testable without faking the clock. */
  now?: Date;
}

/**
 * Throw `AUTH_INVALID_CREDENTIALS` unless the account may hold a session.
 *
 * Order does not matter to the caller: every refusal carries the same code and
 * message, and differs only in `logContext.reason`.
 */
export function assertAccountUsable(
  state: AccountState,
  opts: AccountGateOptions
): void {
  const now = opts.now ?? new Date();

  if (
    opts.enforcePasswordLockout &&
    state.lockedUntil &&
    state.lockedUntil > now
  ) {
    throw NextlyError.invalidCredentials({
      logContext: {
        userId: state.userId,
        reason: auditReason("locked"),
        lockedUntil: state.lockedUntil,
      },
    });
  }

  if (opts.requireEmailVerification && !state.emailVerified) {
    throw NextlyError.invalidCredentials({
      logContext: { userId: state.userId, reason: auditReason("unverified") },
    });
  }

  if (!state.isActive) {
    throw NextlyError.invalidCredentials({
      logContext: { userId: state.userId, reason: auditReason("inactive") },
    });
  }
}
