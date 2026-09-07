/**
 * Typed failures for the sign-in flow.
 *
 * Two audiences, deliberately separated. `reason` is ours: it names the exact
 * cause and reaches the operator log. What the user is told is derived from
 * `kind`, and every authentication failure collapses to one message —
 * distinguishing "no account" from "wrong tenant" from "deactivated" tells an
 * attacker which of those is true, which is the account-enumeration leak core's
 * unified invalid-credentials response exists to prevent.
 *
 * @module errors
 */

/**
 * Why a sign-in did not complete.
 *
 * The values are not interchangeable with the message shown: several map to the
 * same public text on purpose. See {@link isEnumerationSensitive}.
 */
export type SsoFailureReason =
  // Identity resolved, but no local account may be reached through it.
  | "no-linked-account"
  | "unverified-email"
  | "account-claimed"
  | "inactive-user"
  | "no-email"
  // The provider authenticated someone outside the configured boundary.
  | "tenant-not-allowed"
  | "domain-not-allowed"
  | "org-not-allowed"
  // The handoff between the callback and the login endpoint failed.
  | "handoff-expired"
  | "handoff-invalid"
  | "already-redeemed"
  // The transaction that started this sign-in is missing or does not match.
  | "state-mismatch"
  | "transaction-expired"
  | "transaction-invalid"
  // The provider refused, or could not be reached.
  | "provider-denied"
  | "discovery-unavailable"
  | "token-exchange-failed"
  | "id-token-invalid"
  | "userinfo-unavailable"
  // The request itself was malformed.
  | "unknown-provider"
  | "missing-parameters";

/**
 * Reasons that must never be distinguished from one another on the wire.
 *
 * Each answers "does an account exist, and what state is it in" — the question
 * an attacker is asking. A caller renders one message for all of them.
 */
const ENUMERATION_SENSITIVE: ReadonlySet<SsoFailureReason> = new Set([
  "no-linked-account",
  "unverified-email",
  "account-claimed",
  "inactive-user",
  "no-email",
  "tenant-not-allowed",
  "domain-not-allowed",
  "org-not-allowed",
  "handoff-expired",
  "handoff-invalid",
  "already-redeemed",
]);

/** Whether this reason may be reported to the client as itself. */
export function isEnumerationSensitive(reason: SsoFailureReason): boolean {
  return ENUMERATION_SENSITIVE.has(reason);
}

/**
 * A sign-in failure carrying its cause.
 *
 * The cause travels on the error rather than in the message, so a handler can
 * log it in full and answer with something that reveals nothing.
 */
export class SsoError extends Error {
  readonly reason: SsoFailureReason;
  /** Free-form operator detail: an endpoint, a claim name, a provider code. */
  readonly detail?: string;

  constructor(reason: SsoFailureReason, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "SsoError";
    this.reason = reason;
    if (detail !== undefined) this.detail = detail;
  }

  static is(err: unknown): err is SsoError {
    return err instanceof SsoError;
  }
}

/**
 * The query parameter a failed callback redirects with.
 *
 * A code rather than a message: the login screen owns the wording, and a
 * message passed through a URL is one an attacker can also choose.
 */
export type PublicErrorCode =
  | "signin-failed"
  | "signin-cancelled"
  | "signin-restart";

/** Reduce a failure to the code the login screen renders. */
export function toPublicErrorCode(reason: SsoFailureReason): PublicErrorCode {
  if (reason === "provider-denied") return "signin-cancelled";
  if (
    reason === "state-mismatch" ||
    reason === "transaction-expired" ||
    reason === "transaction-invalid" ||
    reason === "missing-parameters"
  ) {
    return "signin-restart";
  }
  return "signin-failed";
}
