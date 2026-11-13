/**
 * The numbers the busy-table bounds are made of, and the help that states them: one home for both,
 * importing nothing, so declaring a command that offers the bounds loads none of the code that
 * uses them (`bounds.ts` reads the same values).
 *
 * @module domains/schema/busy-table/bounds-values
 */

/** One try's bound when nothing sets it, in seconds. */
export const DEFAULT_TRY_SECONDS = 5;

/** The total bound when nothing sets it, in seconds: seven tries with the pauses between them. */
export const DEFAULT_TOTAL_SECONDS = 90;

/** The longest one try may be set to, in seconds: MySQL takes whole seconds from 1. */
export const MAX_TRY_SECONDS = 3_600;

/** The longest the total may be set to, in seconds: a day. */
export const MAX_TOTAL_SECONDS = 86_400;

/** What both flags bound, and what they do not. */
const WHAT_IT_BOUNDS =
  "It bounds the wait for a busy table, not the wait for the schema lock.";

/** The help `--lock-timeout` carries on every command that offers it. */
export const LOCK_TIMEOUT_HELP =
  `Bound one try's wait for a table another database session is using, in whole seconds ` +
  `(1 to ${String(MAX_TRY_SECONDS)}, default ${String(DEFAULT_TRY_SECONDS)}, or ` +
  `NEXTLY_LOCK_TIMEOUT). ${WHAT_IT_BOUNDS} When set longer than the default total, with no ` +
  "total given, the total rises to match.";

/** The help `--lock-timeout-total` carries on every command that offers it. */
export const LOCK_TIMEOUT_TOTAL_HELP =
  `Bound every try for a busy table together, in whole seconds (one try's value to ` +
  `${String(MAX_TOTAL_SECONDS)}, default ${String(DEFAULT_TOTAL_SECONDS)}, or ` +
  `NEXTLY_LOCK_TIMEOUT_TOTAL). ${WHAT_IT_BOUNDS}`;
