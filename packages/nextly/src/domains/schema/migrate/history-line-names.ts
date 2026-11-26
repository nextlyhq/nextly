/**
 * The names the history line's refusals carry, and the line a blank migration states itself by.
 *
 * Their own module, importing nothing, because two places read them: the history line
 * (`history-line`, which re-exports them), and the CLI's error table, which names each refusal and
 * tells the reader the line to add. The history line's module loads the snapshots and the
 * database's dialects; reading a name from it would load them into every command that loads the
 * error table.
 *
 * @module domains/schema/migrate/history-line-names
 */

/** The `logContext.reason` of a refusal over a forked history. */
export const HISTORY_FORKED_REASON = "migration history forked";

/**
 * The `logContext.reason` of a refusal over a migration whose files (its base file and a
 * dialect's variant) state different places in the line (`placeStatedTwiceError`).
 */
export const MIGRATION_PLACE_STATED_TWICE_REASON =
  "migration place stated twice";

/**
 * The line `migrate:create --blank` has written in every blank migration's header, before a
 * blank file stated its place and since.
 */
export const BLANK_FILE_LINE =
  "-- This is a blank migration file for custom SQL.";

/**
 * The header line `migrate:create` writes in every file it generates, a blank one included,
 * followed by the time. A file without it was written by hand, which no snapshot is owed for.
 */
export const GENERATED_FILE_LINE = "-- Generated at:";
