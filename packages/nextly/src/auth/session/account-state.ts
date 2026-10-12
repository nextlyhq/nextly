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
 * unknown one. The one exception is an unverified address after the password
 * was proven correct (see {@link AccountGateOptions.passwordProven}).
 *
 * @module auth/session/account-state
 * @since 1.0.0
 */
import { auditReason } from "../../domains/audit/audit-reasons";
import { NextlyError } from "../../errors/nextly-error";

/**
 * @experimental The account facts the gate decides on, as stored on the user
 * row.
 */
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
  /**
   * When an administrator deactivated the account. Only the password path
   * reads it, to decide whether naming an unverified address would help: a
   * deactivated account is sent no verification link, so it is refused like
   * any other deactivated account instead.
   */
  deactivatedAt?: Date | null;
  /**
   * When the account's password was last set; null when it never has been.
   * The session-row write compares it with the value read when the sign-in
   * or refresh began, so a password set in between refuses the session the
   * old credentials were about to receive. The column holds whole seconds on
   * MySQL and SQLite, so two writes within one second read as one.
   *
   * Required, so a state read that leaves it out fails to compile rather
   * than reading as "never set" and refusing, or admitting, every session.
   */
  passwordUpdatedAt: Date | null;
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
  /**
   * Whether the caller has just proven the account's password. Only then, and
   * only for an account no administrator deactivated, is an unverified address
   * refused as `EMAIL_NOT_VERIFIED` rather than the generic error, so the login
   * page can offer to resend the link. It does confirm the
   * password to whoever typed it, which is why it waits for the proof: a wrong
   * guess still answers generically and still counts toward the lockout, and
   * the right one still issues no session. Every other path leaves it unset
   * and stays generic.
   */
  passwordProven?: boolean;
  /** Overridable so the lock comparison is testable without faking the clock. */
  now?: Date;
}

/**
 * Throw `AUTH_INVALID_CREDENTIALS` unless the account may hold a session.
 *
 * Every refusal carries the same code and message and differs only in
 * `logContext.reason`, except an unverified address when `passwordProven` is
 * set and no administrator has deactivated the account. The lockout is judged
 * first, so a locked account answers generically even to a correct password.
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
    const logContext = {
      userId: state.userId,
      reason: auditReason("unverified"),
    };
    // Named only where acting on it can work: the password was proven, and the
    // account is not one an administrator deactivated, which is sent no
    // verification link. Telling that account to verify would send its owner
    // to a resend that never arrives.
    throw opts.passwordProven && !state.deactivatedAt
      ? NextlyError.emailNotVerified({ logContext })
      : NextlyError.invalidCredentials({ logContext });
  }

  if (!state.isActive) {
    throw NextlyError.invalidCredentials({
      logContext: { userId: state.userId, reason: auditReason("inactive") },
    });
  }
}

/**
 * The gate as a question rather than an error: whether an account may hold a
 * session, for a caller that refuses in its own way rather than by throwing —
 * a refresh ending the session it was asked to renew, a session check
 * answering a plugin-resolved user as nobody.
 *
 * `null`, an account that no longer exists, may not. An error that is not the
 * gate's own refusal is rethrown: a failure to judge is not a judgement.
 */
export function accountMayHoldSession(
  state: AccountState | null,
  opts: AccountGateOptions
): boolean {
  if (!state) return false;
  try {
    assertAccountUsable(state, opts);
    return true;
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return false;
  }
}
