/**
 * The `logContext.reason` of each refusal a writer of the migrations folder makes.
 *
 * Their own module, importing nothing, because two places read them: the hold (`writer-hold`),
 * and the CLI's error table, which tells the refusals apart by them. The
 * hold's module loads the schema lock and the database's dialects; reading a reason from it would
 * load them into every command that loads the error table.
 *
 * @module domains/schema/migrate-create/writer-hold-reasons
 */

/** The `logContext.reason` of a refusal over a held folder. */
export const WRITER_HOLD_HELD_REASON = "migration files held by another writer";

/** The `logContext.reason` of a writer that lost its hold. */
export const WRITER_HOLD_LOST_REASON = "migration writer hold lost while held";

/** The `logContext.reason` of a writer whose starting snapshot is no longer the newest. */
export const WRITER_START_MOVED_REASON =
  "another writer wrote a migration after this one read the newest";

/** What a writer says of a migration file it could not put in place. */
export const WRITER_NOT_WRITTEN_REASON =
  "migration file could not be put in place";
