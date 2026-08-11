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
/**
 * What the repaired column must still be afterwards, when the caller can say.
 *
 * A rename is produced by COLLAPSING a `drop_column` and an `add_column`, and the add carried the
 * column's nullability and default. Collapsing them away discards that, so a caller which has the
 * consumed pair passes it back in here. Without it the conversion can only restate the type, which
 * on MySQL means the column silently loses its `NOT NULL` and its default.
 */
export interface RenameConversionContext {
  /** The column spec the collapsed `add_column` declared. */
  target?: { nullable: boolean; default?: string };
  /**
   * What the ORIGINAL column was, read from the previous snapshot.
   *
   * Needed in both directions. A generated DOWN restores this definition, and on MySQL it must
   * RESTATE it — `MODIFY COLUMN` deletes whatever it omits. On PostgreSQL the default is recorded on
   * the drop so the inverse can put it back: `buildInverseOperations` inverts a default change by
   * assigning `toDefault: op.fromDefault`, so leaving it undefined makes the rollback emit a second
   * DROP DEFAULT instead of restoring what was there.
   */
  source?: { nullable?: boolean; default?: string };
}

export function conversionForRename(
  rename: RenameColumnOp,
  dialect: SupportedDialect,
  context: RenameConversionContext = {}
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

  if (dialect === "mysql") {
    // Carried on the op itself because MySQL has no other way to express them: MODIFY restates the
    // whole definition and there is no renderable statement for nullability alone.
    if (context.target) {
      change.nullable = context.target.nullable;
      change.columnDefault = context.target.default;
    }
    // The other direction, for the generated DOWN. Recorded here because this is the only point that
    // has both definitions at once.
    if (context.source) {
      change.fromNullable = context.source.nullable;
      change.fromColumnDefault = context.source.default;
    }
    return [change];
  }

  // PostgreSQL from here.
  //
  // 🔴 It converts the ROWS, not the default. `ALTER COLUMN … TYPE jsonb USING …` applies its USING
  // expression to stored values and leaves the DEFAULT expression alone — so a text default on a
  // column becoming JSON is still a text expression, and PostgreSQL rejects the whole statement.
  // Every row can be valid JSON and the conversion still fails. The old default therefore comes off
  // first.
  //
  // `fromDefault` records what was there rather than `undefined`, because that is what a generated
  // DOWN reads to put it back.
  const ops: Operation[] = [
    {
      type: "change_column_default",
      tableName: rename.tableName,
      columnName: rename.toColumn,
      fromDefault: context.source?.default,
      toDefault: undefined,
    },
    change,
  ];

  // PostgreSQL preserves the column's nullability across a type change, so a repair that coincides
  // with the field becoming required (or stopping being required) would leave the old setting behind
  // — the UP contradicting the snapshot it was generated from, and the DOWN unable to restore what
  // was there. MySQL needs no equivalent: its MODIFY restates nullability with the type, which is
  // why the same fact travels on the op there and as its own statement here.
  //
  // Emitted as `change_column_nullable`, which the inverse builder already knows how to swap.
  if (
    context.source?.nullable !== undefined &&
    context.target?.nullable !== undefined &&
    context.source.nullable !== context.target.nullable
  ) {
    ops.push({
      type: "change_column_nullable",
      tableName: rename.tableName,
      columnName: rename.toColumn,
      fromNullable: context.source.nullable,
      toNullable: context.target.nullable,
    });
  }

  // And the desired default goes back on after the type is right. Omitted when the target declares
  // none — an unconditional SET DEFAULT would invent one the schema never asked for.
  //
  // In the apply pipeline this is redundant: the schema push that follows reconciles defaults
  // against the desired snapshot. In a generated migration file nothing follows, which is where its
  // absence left the column without the default its own snapshot declares.
  if (context.target?.default !== undefined) {
    ops.push({
      type: "change_column_default",
      tableName: rename.tableName,
      columnName: rename.toColumn,
      fromDefault: undefined,
      toDefault: context.target.default,
    });
  }

  return ops;
}
