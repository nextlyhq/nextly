/**
 * What to do when a schema transition COMMITTED and recording it did not.
 *
 * The tables have moved. The row describing them has not. Every caller that can reach this state
 * owes the operator the same three answers, and getting any of them wrong is worse than the
 * original failure:
 *
 * - the failure was recorded, so the group is marked and must be reconciled, not retried;
 * - the row turned out to have advanced, so the CHANGE was probably recorded and only confirming
 *   it failed — reload before doing anything;
 * - nothing could be recorded at all, so the log is the only trace.
 *
 * 🔴 This lives in one place because two paths reach it — the metadata service's update and the
 * builder's apply — and they write genuinely different rows. Sharing the WRITE is not possible;
 * sharing the DECISION is, and the decision is the part that must not drift. Two copies of it
 * would agree on the day they were written and diverge silently afterwards, which is the failure
 * mode this repository has hit in five unrelated packages.
 *
 * The caller supplies its own answer to "does the stored row already carry MY edit", because only
 * the caller knows what it sent. Everything downstream of that answer is decided here.
 *
 * @module domains/field-groups/services/record-stranded-transition
 */

import { NextlyError } from "../../../errors";
import { NEXTLY_ERROR_STATUS } from "../../../errors/error-codes";
import type { Logger } from "../../../shared/types";

import type { FieldGroupRegistryService } from "./field-group-registry-service";

/** Which of the three endings actually happened, in the order they are attempted. */
type RecordState = "marked" | "advanced" | "unrecorded";

export interface RecordStrandedTransitionArgs<R> {
  registry: FieldGroupRegistryService;
  logger: Logger;
  slug: string;
  /** The version the edit started from — the predicate the conditional mark is attempted at. */
  expectedSchemaVersion: number;
  /** For the log only, so the group is findable when the mark itself could not be written. */
  tableName: string;
  wasLocalized: boolean;
  /** Whatever the failed write raised. */
  cause: unknown;
  /**
   * Re-read the row and answer whether it ALREADY carries this edit, or `null` on ANY doubt.
   *
   * Doubt must resolve to "not settled": treating an unreadable row as written would swallow a
   * real divergence, which is the state this whole path exists to surface. A re-read that itself
   * fails is the likely case when the database is why the first write raised.
   */
  readBackSettled: () => Promise<R | null>;
}

/**
 * Record a committed-but-unrecorded transition, then either report success or refuse.
 *
 * Returns ONLY when the row turned out to already carry the edit — the write landed and the raise
 * was in reading it back, which is a success the caller may report. Every other path throws,
 * because the caller must not tell anyone the edit succeeded.
 */
export async function recordStrandedTransition<R>(
  args: RecordStrandedTransitionArgs<R>
): Promise<{ record: R }> {
  const {
    registry,
    logger,
    slug,
    expectedSchemaVersion,
    tableName,
    wasLocalized,
    cause,
    readBackSettled,
  } = args;

  logger.error(
    "[FieldGroups] Schema transition committed but its registry row was not written.",
    {
      slug,
      tableName,
      wasLocalized,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  );

  let recordState: RecordState = "unrecorded";
  try {
    const outcome = await registry.updateComponentIfVersion(
      slug,
      { migrationStatus: "diverged" },
      expectedSchemaVersion,
      { source: "code" }
    );
    if (outcome.matched) {
      recordState = "marked";
    } else {
      // The row is past the version this edit started from, which is what the original write
      // leaves behind — so the change may well have been recorded and the raise was in reading it
      // back. Look once more: connectivity good enough for the conditional statement is usually
      // good enough for a read now.
      const settled = await readBackSettled();
      if (settled !== null) {
        logger.warn(
          "[FieldGroups] The registry write raised but the row already carries the change; the error was in reading it back.",
          { slug }
        );
        return { record: settled };
      }
      // 🔴 The version moved AND the row does not carry this edit. So another writer advanced the
      // row while this edit's tables had already moved, and the definition now stored describes
      // neither: that is divergence, and it is the state the mark exists for.
      //
      // Marked at the version just READ rather than at this edit's, because the row is past that
      // one by definition. Attempted ONCE: a writer racing this second attempt has itself just
      // written the row, so retrying in a loop trades a bounded failure for an unbounded one.
      const current = await registry.getComponent(slug);
      const remark = await registry.updateComponentIfVersion(
        slug,
        { migrationStatus: "diverged" },
        current.schemaVersion,
        { source: "code" }
      );
      if (remark.matched) {
        recordState = "marked";
        logger.warn(
          "[FieldGroups] The row advanced past this edit's version without carrying it; marked diverged at the version now stored.",
          {
            slug,
            expectedSchemaVersion,
            markedAtSchemaVersion: current.schemaVersion,
          }
        );
      } else {
        recordState = "advanced";
        logger.error(
          "[FieldGroups] The row advanced past this edit's version and moved again before it could be marked diverged.",
          { slug, expectedSchemaVersion }
        );
      }
    }
  } catch (markError) {
    logger.error(
      "[FieldGroups] Could not mark the field group as diverged either.",
      {
        slug,
        error:
          markError instanceof Error ? markError.message : String(markError),
      }
    );
  }

  // Constructed rather than `NextlyError.internal`, which fixes the public message to "An
  // unexpected error occurred." That is the one thing this caller must NOT be told: the edit
  // half-happened and repeating it is harmful. The status still comes from the central mapping
  // rather than a literal, so this cannot drift from the code it carries.
  //
  // 🔴 The message distinguishes what was PERSISTED. Claiming a durable record that does not exist
  // is worse than admitting the log is the only trace — and claiming nothing was recorded when the
  // row demonstrably advanced sends an operator repairing a group that likely carries the change
  // already. Each ending tells them where to look and what not to do.
  const publicMessages: Record<RecordState, string> = {
    marked: `The field group's tables were changed, but recording the change failed. "${slug}" is marked as diverged and its stored definition still describes the previous shape. Do not retry the same edit: check the server logs and reconcile the field group before editing it again.`,
    // 🔴 Says only what the write PROVED: the row is no longer at the version this edit started
    // from. `matched: false` has two causes — the row advanced, or it was deleted — and a
    // concurrent delete reaches here through the same path, because the confirming read then
    // raises NOT_FOUND and reports the same "could not confirm". Claiming a newer version exists
    // would send that operator to reload a field group that is gone.
    advanced: `The field group's tables were changed, and its record is no longer at the version this edit started from — most likely the change was recorded and only confirming it failed, though the field group may also have been deleted. Reload "${slug}" before doing anything else; retry the edit only if it still exists and the reloaded definition does not show the change.`,
    unrecorded: `The field group's tables were changed, but neither the change nor the failure could be recorded. "${slug}" still reads as though nothing happened, and the only trace is the server log. Do not retry the same edit: reconcile the field group against its tables before editing it again.`,
  };

  throw new NextlyError({
    code: "INTERNAL_ERROR",
    statusCode: NEXTLY_ERROR_STATUS.INTERNAL_ERROR,
    publicMessage: publicMessages[recordState],
    logContext: { slug, tableName, recordState, expectedSchemaVersion },
    cause: cause instanceof Error ? cause : undefined,
  });
}
