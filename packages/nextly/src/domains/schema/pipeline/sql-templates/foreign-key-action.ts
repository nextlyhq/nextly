// The statements that move a foreign key's referential actions, shared by the
// dialects that can perform the change at all.

import { NextlyError } from "../../../../errors/nextly-error";
import type { ChangeForeignKeyActionOp } from "../diff/types";

/**
 * Drop the constraint and declare it again with the new actions.
 *
 * Two statements, and on both dialects that is a requirement rather than a
 * preference. The constraint keeps its name here — an action edit renames
 * nothing — and MySQL rejects a drop and an add of one name in a single
 * `ALTER TABLE` outright (bug #68286, error 1826, still open), while on
 * PostgreSQL a combined statement would depend on the order the server applies
 * its subcommands in, which nothing here can test.
 *
 * The two dialects differ only in how they spell the drop and quote a name, so
 * they share the shape: two spellings of one rule drift, and the drift is
 * silent because each reads correctly on its own.
 *
 * @param dropVerb `DROP CONSTRAINT` on PostgreSQL; `DROP FOREIGN KEY` on
 *   MySQL, which accepts the former only from 8.0.19.
 */
export function changeForeignKeyActionSql(
  op: ChangeForeignKeyActionOp,
  q: (name: string) => string,
  dropVerb: "DROP CONSTRAINT" | "DROP FOREIGN KEY"
): string {
  return (
    `ALTER TABLE ${q(op.tableName)} ${dropVerb} ${q(op.constraintName)}; ` +
    `ALTER TABLE ${q(op.tableName)} ADD CONSTRAINT ${q(op.constraintName)} ` +
    `FOREIGN KEY (${q(op.columnName)}) REFERENCES ${q(op.referencesTable)}` +
    `(${q(op.referencesColumn)}) ON DELETE ${op.toOnDelete} ON UPDATE ${op.toOnUpdate}`
  );
}

/**
 * Refuse an operation a dialect's dispatcher does not handle.
 *
 * The parameter is typed `never`, which is what keeps this equivalent to the
 * block it replaces: a dispatcher that stops covering the whole `Operation`
 * union no longer type-checks at its own call to this, per dialect, at compile
 * time. Adding a member to the union is therefore still an error in every
 * dialect that has not handled it — which is how a new operation locates its
 * consumers instead of failing at run time on whichever dialect a user happens
 * to be on.
 *
 * Shared because the three dispatchers spelled the identical block, and a
 * message that drifts between them is a message that names the wrong function.
 */
export function unsupportedOperation(generator: string, op: never): never {
  throw NextlyError.internal({
    logContext: {
      reason: "unsupported-sql-template-op",
      generator,
      op: (op as { type: string }).type,
    },
  });
}
