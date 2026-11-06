import { recordRefusalReason } from "../auth/access/refusal-message";
import { safeCode } from "../database/errors";
import { firstAnswer } from "../database/missing-column";
import { POOL_WAIT_TIMEOUT_CODE } from "../database/pool-wait-code";

import { NextlyError } from "./nextly-error";

/**
 * Whether `error`, or any error in its cause chain, is a request that waited
 * out the bound for a pooled database connection, and only that. A rule that
 * queries the database and is given no connection never answered, so what it
 * guards cannot be decided; any other throw is the rule's own failure, which
 * still refuses. SQLite's busy file is not this: it has no pool to wait on.
 *
 * The chain is walked because the wait rarely arrives as thrown: a rule that
 * catches it and throws its own error, or a service that wraps it, keeps it
 * as a cause.
 */
export function waitedOutPoolBound(error: unknown): boolean {
  return (
    firstAnswer(error, link =>
      safeCode(link) === POOL_WAIT_TIMEOUT_CODE ? true : undefined
    ) === true
  );
}

/**
 * The `RULE_COULD_NOT_RUN` answer `error` carries, itself or in its cause
 * chain, or undefined. Read through the chain because a transaction re-wraps
 * what leaves it, so a rule that could not run inside one arrives as the
 * cause of the adapter's error.
 */
export function ruleCouldNotRunIn(error: unknown): NextlyError | undefined {
  return firstAnswer(error, link =>
    NextlyError.is(link) && link.code === "RULE_COULD_NOT_RUN"
      ? link
      : undefined
  );
}

/**
 * Throw the `RULE_COULD_NOT_RUN` answer `error` carries, if it carries one.
 *
 * For a catch around anything that asks an access or field rule: a rule that
 * could not run never answered, so its request ends with that answer. Read as
 * a refusal, a missing document, an empty list or an allow, it would tell the
 * caller something no rule said. Every other error is left to the catch.
 */
export function rethrowIfRuleCouldNotRun(error: unknown): void {
  const couldNotRun = ruleCouldNotRunIn(error);
  if (couldNotRun) throw couldNotRun;
}

/**
 * {@link rethrowIfRuleCouldNotRun} for settled results: the first rejection
 * that is a rule that could not run is thrown, whatever the others did.
 */
export function rethrowIfAnyRuleCouldNotRun(
  results: readonly PromiseSettledResult<unknown>[]
): void {
  for (const result of results) {
    if (result.status === "rejected") rethrowIfRuleCouldNotRun(result.reason);
  }
}

/**
 * The answer for a rule that could not run because its own query waited out
 * the bound for a database connection, recorded in the refusal log as it is
 * raised. The request it ends is refused with it, whatever way in reached the
 * rule, so the operator sees which rule and why, as for any other refusal.
 */
export function ruleCouldNotRun(opts: {
  /** The collection or Single whose rule it is. */
  subject: string;
  /** The field, for a field's rule. */
  field?: string;
  /** Which rule, in words: "the update rule", "the field rule for update". */
  rule: string;
  cause: unknown;
}): NextlyError {
  const error = NextlyError.ruleCouldNotRun({
    subject: opts.subject,
    ...(opts.field !== undefined ? { field: opts.field } : {}),
    cause: opts.cause instanceof Error ? opts.cause : undefined,
    logContext: { rule: opts.rule },
  });
  recordRefusalReason({
    status: error.statusCode,
    code: "RULE_COULD_NOT_RUN",
    reason: `${opts.rule} of ${opts.subject}${
      opts.field !== undefined ? `, field ${opts.field},` : ""
    } could not run: its query waited out the bound for a database connection`,
  });
  return error;
}
