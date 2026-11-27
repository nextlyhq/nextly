/**
 * The points a field-group storage migration can be stopped at by a test (`reachStopPoint`,
 * `NEXTLY_TEST_KILL_AT`), named once so the run and the suites that kill it agree.
 *
 * Each sits where a run that dies leaves the next one something to work out: work committed and its
 * progress not yet recorded.
 *
 * @module domains/field-groups/migration/stop-point-names
 */

/** A batch of the content rewrite has committed; its cursor is not yet written. */
export const REWRITE_BATCH_COMMITTED = "field-groups:rewrite:batch-committed";

/** A rename step has committed; the marker does not yet record it. */
export const RENAME_STEP_COMMITTED = "field-groups:rename:committed";

/** A data step has committed; the marker does not yet record it. */
export const DATA_STEP_COMMITTED = "field-groups:data:committed";
