/**
 * A statement as its caller wrote it, for tests that judge statements by how they start.
 *
 * A run holding the schema lock sends each schema statement behind comments of its own: the lock's
 * claim, and what the statement was sent for (`markedForSchemaLock`). A test that asks whether a
 * statement starts with `ALTER` or `INSERT INTO` asks about the statement, not those comments, and
 * on PostgreSQL and MySQL, where the comments are sent, would otherwise never match it. Every
 * leading block comment is removed, so the test does not depend on how many the lock writes.
 */

/** `statement` without the block comments in front of it. */
export function asWritten(statement: string): string {
  return statement.replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)*/, "");
}
