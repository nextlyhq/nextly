/**
 * The type change a confirmed rename needs, decided once.
 *
 * A rename moves a column; it does not change what the column IS. When the two sides of a confirmed
 * rename describe different types, the rename alone leaves the old type in place under the new name,
 * and from that moment the schema the runtime reads through and the column it actually reads
 * disagree.
 *
 * Two places act on a confirmed rename and both need this answer:
 *
 *   `executePreResolutionOps`   applies it against a live database
 *   `migrate:create`            writes it into a migration file
 *
 * They had one answer between them — the apply path converted and the generated migration did not,
 * so a repo-committed migration left `text` where the snapshot and the runtime expected JSON, and
 * its DOWN omitted the reverse. This module is that answer, stated once, so the two cannot drift:
 * the executor renders it to SQL, `migrate:create` carries it as an operation its own renderer and
 * its inverse-builder already understand.
 *
 * @module domains/schema/pipeline/rename-conversion
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type {
  ChangeColumnDefaultOp,
  ChangeColumnTypeOp,
  Operation,
  RenameColumnOp,
} from "./diff/types";

/**
 * The operations a rename needs to finish, in order. Empty when it needs none.
 *
 * Empty for SQLite on purpose rather than by omission: it has no ALTER that changes a column's
 * type, and it needs none here, because it stores JSON as text — so the two sides of the one
 * convertible change name the same storage. Asking for a conversion there would raise
 * `SqliteUnsupportedOperationError` for a column that is already correct.
 */
export function conversionForRename(
  rename: RenameColumnOp,
  dialect: SupportedDialect
): Operation[] {
  if (dialect === "sqlite") return [];
  if (!rename.fromType || !rename.toType) return [];
  if (rename.fromType === rename.toType) return [];

  const change: ChangeColumnTypeOp = {
    type: "change_column_type",
    tableName: rename.tableName,
    // The NEW name. The conversion runs after the rename, so the column no longer answers to the
    // one it had.
    columnName: rename.toColumn,
    fromType: rename.fromType,
    toType: rename.toType,
  };

  if (dialect !== "postgresql") return [change];

  // 🔴 PostgreSQL converts the ROWS, not the default.
  //
  // `ALTER COLUMN … TYPE jsonb USING …` applies its USING expression to stored values and leaves the
  // column's DEFAULT expression alone — so a text default that the old column legitimately carried
  // (the `'{}'` left behind when a required repeater was added to a populated table) is still a text
  // expression on a column that is now JSON, and PostgreSQL rejects the whole statement. Every row
  // can be valid JSON and the conversion still fails.
  //
  // Dropped rather than translated: what the column's default SHOULD be is a property of the desired
  // schema, not of the column being repaired, and the pass that follows this one already reconciles
  // defaults. Translating it here would be this module inventing an answer another one owns.
  const dropDefault: ChangeColumnDefaultOp = {
    type: "change_column_default",
    tableName: rename.tableName,
    columnName: rename.toColumn,
    fromDefault: undefined,
    toDefault: undefined,
  };

  return [dropDefault, change];
}
