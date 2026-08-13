/**
 * Whether re-reading could change a refusal's answer.
 *
 * A leaf module on purpose. Both the code that RAISES these refusals
 * (`reconcile`, and the settled-marker verification in `run`) and the code that
 * DECIDES whether to re-read (`run`) need this vocabulary, and putting it behind
 * either of them would make one import the other for a string constant.
 *
 * @module domains/field-groups/migration/refusal-kind
 */

import { NextlyError } from "../../../errors/nextly-error";

/**
 * `torn-read` means the refusal describes a DISAGREEMENT between two reads
 * rather than a fact about the database. An unlocked observer reads the marker
 * and the catalog as separate queries, and a writer advancing between them
 * produces a pair no single instant ever held; reading again can resolve it.
 *
 * `permanent` means the database is genuinely in a shape a human has to look at,
 * and every re-read returns the same thing.
 */
export type RefusalKind = "permanent" | "torn-read";

/** The `logContext` key the classification travels under. */
export const REFUSAL_KIND_KEY = "refusalKind";

/**
 * Whether this refusal is one a concurrent writer can manufacture.
 *
 * Answered from the marker the refusal itself carries rather than by matching
 * its `reason` text. A caller holding its own list of retryable messages would
 * be a second implementation of this classification: rewording a refusal would
 * silently move it between categories, and nothing would fail.
 */
export function isTornReadRefusal(error: unknown): boolean {
  return (
    NextlyError.is(error) &&
    error.logContext?.[REFUSAL_KIND_KEY] === "torn-read"
  );
}
