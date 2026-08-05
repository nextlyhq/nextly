/**
 * The `reason` vocabulary an audit row may retain.
 *
 * A failed authentication is recorded with NO actor, precisely so the row
 * cannot say which account was reached. That is also what makes it permanent:
 * nothing links it to a person, so the deletion that erases someone's other
 * rows can never find this one. Every value stored on it therefore has to come
 * from a vocabulary this package controls, and `reason` is the one that would
 * otherwise carry free text — an `AuthStrategy` is application code and its
 * failure result names its own reason.
 *
 * Listing the values is not enough on its own: an allowlist maintained apart
 * from the producers drifts, and the drift is silent, because a reason outside
 * the list is dropped rather than rejected. So producers emit through
 * `auditReason`, which accepts only a member of this list — a new reason is a
 * type error until it is named here, and naming it here is what admits it to
 * the trail.
 *
 * @module domains/audit/audit-reasons
 * @since 1.0.0
 */

/**
 * Reasons emitted on paths whose failure is recorded: credential
 * verification, strategy dispatch, challenge resolution, and the
 * initial-password exchange.
 *
 * Each describes WHY an attempt failed, never WHO attempted it. A value that
 * would identify a person does not belong here, whatever it is called.
 */
export const AUDIT_REASONS = [
  // Credential verification.
  "user-not-found",
  "password-mismatch",
  "current-password-mismatch",
  "no-password-hash",
  "unverified",
  "inactive",
  "locked",
  // Strategy dispatch.
  "strategy-fail",
  "no-strategy-matched",
  // Pending-token exchanges: challenge resolution and initial password.
  "pending-token-invalid",
  "pending-token-wrong-challenge",
  "challenge-failed-final",
  "challenge-attempts-exhausted",
  "challenge-user-missing",
  "not-in-must-change-state",
  "user-missing",
] as const;

/** A reason an audit row may retain. */
export type AuditReason = (typeof AUDIT_REASONS)[number];

const AUDIT_REASON_SET: ReadonlySet<string> = new Set(AUDIT_REASONS);

/** Whether a value is a reason this package produces. */
export function isAuditReason(value: unknown): value is AuditReason {
  return typeof value === "string" && AUDIT_REASON_SET.has(value);
}

/**
 * Name a reason that survives into the audit trail.
 *
 * `logContext` is an untyped bag, so a reason written inline is checked by
 * nothing and a new one is dropped by the projection without any diagnostic.
 * Passing it through here makes the compiler reject a reason the trail would
 * silently discard, which is the only reliable way to keep the producers and
 * the vocabulary in step:
 *
 * ```ts
 * logContext: { reason: auditReason("password-mismatch"), userId: user.id }
 * ```
 *
 * The value is returned unchanged; this exists for the type, not the runtime.
 */
export function auditReason(reason: AuditReason): AuditReason {
  return reason;
}
