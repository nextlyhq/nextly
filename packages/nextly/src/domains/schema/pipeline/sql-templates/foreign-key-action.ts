// The statements that move a foreign key's referential actions, shared by the
// dialects that can perform the change at all.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../../errors/nextly-error";
import type { ChangeForeignKeyActionOp } from "../diff/types";

import { quoteIdent } from "./identifier-quoting";

/**
 * The dialects that can move a referential action in place.
 *
 * SQLite cannot: it reaches this operation only to refuse it, so it is absent
 * here rather than carried as a case nothing can render.
 */
export type ForeignKeyActionDialect = Exclude<SupportedDialect, "sqlite">;

/**
 * How each dialect spells removing a constraint.
 *
 * Not interchangeable: MySQL accepts `DROP CONSTRAINT` only from 8.0.19, and
 * this has to work on the oldest supported server.
 */
const DROP_VERB: Record<ForeignKeyActionDialect, string> = {
  postgresql: "DROP CONSTRAINT",
  mysql: "DROP FOREIGN KEY",
};

/**
 * Remove a foreign key by the name it actually carries.
 *
 * Rendered on its own, rather than only as half of
 * {@link changeForeignKeyActionStatements}, because a caller that has READ the
 * live table knows two things this operation cannot: the name the constraint
 * really has, and whether it is there at all. Such a caller emits the pair,
 * only the add, or one drop per live name — and every one of those statements
 * is still written in exactly one place, so no path can spell the drop
 * differently from the path beside it.
 */
export function dropForeignKeySql(
  tableName: string,
  constraintName: string,
  dialect: ForeignKeyActionDialect
): string {
  const q = (name: string) => quoteIdent(name, dialect);
  return `ALTER TABLE ${q(tableName)} ${DROP_VERB[dialect]} ${q(constraintName)}`;
}

/** Declare the key again, carrying the operation's target actions. */
export function addForeignKeySql(
  op: ChangeForeignKeyActionOp,
  dialect: ForeignKeyActionDialect
): string {
  const q = (name: string) => quoteIdent(name, dialect);
  return (
    `ALTER TABLE ${q(op.tableName)} ADD CONSTRAINT ${q(op.constraintName)} ` +
    `FOREIGN KEY (${q(op.columnName)}) REFERENCES ${q(op.referencesTable)}` +
    `(${q(op.referencesColumn)}) ON DELETE ${op.toOnDelete} ON UPDATE ${op.toOnUpdate}`
  );
}

/**
 * Drop the constraint and declare it again with the new actions.
 *
 * TWO statements, and on both dialects that is a requirement rather than a
 * preference. The constraint keeps its name here — this operation renames
 * nothing — and MySQL rejects a drop and an add of one name in a single
 * `ALTER TABLE` outright (bug #68286, error 1826, still open), while on
 * PostgreSQL a combined statement would depend on the order the server applies
 * its subcommands in, which nothing here can test.
 *
 * Returned as a LIST rather than one joined string because the list is what
 * the databases actually need, and a caller that is handed a string has to
 * take it apart again to run them. One of them took it apart on `; ` — a split
 * that is unsafe in general (a default value may contain the separator) — and
 * one did not take it apart at all, which is how a compound statement reached
 * a MySQL driver configured with `multipleStatements = false` and was rejected
 * whole. {@link changeForeignKeyActionSql} joins them for the file path that
 * genuinely wants one string.
 */
export function changeForeignKeyActionStatements(
  op: ChangeForeignKeyActionOp,
  dialect: ForeignKeyActionDialect
): readonly [string, string] {
  return [
    dropForeignKeySql(op.tableName, op.constraintName, dialect),
    addForeignKeySql(op, dialect),
  ];
}

/**
 * The single-string form `generateSQL` promises its callers, derived from the
 * list rather than written a second time.
 */
export function changeForeignKeyActionSql(
  op: ChangeForeignKeyActionOp,
  dialect: ForeignKeyActionDialect
): string {
  return changeForeignKeyActionStatements(op, dialect).join("; ");
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
export function unsupportedOperation(
  generator: string,
  // `{ type }` rather than `never`: `never` stays assignable (the default
  // branches keep their exhaustiveness guarantee), and a dialect can refuse
  // an op EXPLICITLY — SQLite and in-place constraint DDL — without hand-
  // rolling its own error.
  op: { type: string }
): never {
  throw NextlyError.internal({
    logContext: {
      reason: "unsupported-sql-template-op",
      generator,
      op: op.type,
    },
  });
}
