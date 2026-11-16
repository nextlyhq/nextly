/**
 * A statement as its caller wrote it, for tests that judge statements by how they start.
 *
 * A run holding the schema lock sends each schema statement behind comments of its own: the lock's
 * claim, `/* nextly-lock:<claim> *\/`, and what the statement was sent for, `/* nextly-unit:<name> *\/`
 * (`markedForSchemaLock`). A test that asks whether a statement starts with `ALTER` or
 * `INSERT INTO` asks about the statement, not those comments, which are sent on PostgreSQL and
 * MySQL only. Exactly those two comments, and the space after each, are removed; any other
 * comment, a hint or an executable comment, and the statement's own whitespace stay as written.
 */
import {
  UNIT_COMMENT_CLOSE,
  UNIT_COMMENT_OPEN,
} from "../../domains/schema/pipeline/lock-statement-unit";

/** Text a pattern matches literally. */
const literal = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * The lock's comments at the start of a statement: the claim's, which holds no `*`, then, where
 * one was written, the unit's, whose encoded name holds only letters, digits and `%._-`.
 */
const LOCK_COMMENTS = new RegExp(
  `^/\\* nextly-lock:[^*]* \\*/ (?:${literal(UNIT_COMMENT_OPEN)}[A-Za-z0-9%._-]+${literal(UNIT_COMMENT_CLOSE)} )?`
);

/** `statement` without the comments a schema-lock holder sent in front of it. */
export function asWritten(statement: string): string {
  return statement.replace(LOCK_COMMENTS, "");
}
