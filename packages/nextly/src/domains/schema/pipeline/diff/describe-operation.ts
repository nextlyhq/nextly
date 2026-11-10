/**
 * One line naming a schema operation, for every command that lists them.
 *
 * @module domains/schema/pipeline/diff/describe-operation
 */
import type { Operation } from "./types";

/**
 * Render an Operation as a short human-readable summary: what `migrate:check`
 * lists as drift and what `db:sync --dry-run` names as the push's changes.
 * Mirrors the apply pipeline's logging style for consistency.
 */
export function describeOp(op: Operation): string {
  switch (op.type) {
    case "add_table":
      return `add_table ${op.table.name}`;
    case "drop_table":
      return `drop_table ${op.tableName}`;
    case "rename_table":
      return `rename_table ${op.fromName} -> ${op.toName}`;
    case "add_column":
      return `add_column ${op.tableName}.${op.column.name} (${op.column.type})`;
    case "drop_column":
      return `drop_column ${op.tableName}.${op.columnName}`;
    case "rename_column":
      return `rename_column ${op.tableName}.${op.fromColumn} -> ${op.toColumn}`;
    case "change_column_type":
      return `change_column_type ${op.tableName}.${op.columnName} (${op.fromType} -> ${op.toType})`;
    case "change_column_nullable":
      return `change_column_nullable ${op.tableName}.${op.columnName} (${op.fromNullable} -> ${op.toNullable})`;
    case "change_column_default":
      return `change_column_default ${op.tableName}.${op.columnName}`;
    case "add_index":
      return `add_index ${op.index.name} on ${op.tableName}`;
    case "drop_index":
      return `drop_index ${op.index.name} on ${op.tableName}`;
    case "add_check":
      return `add_check ${op.check.name} on ${op.tableName}`;
    case "drop_check":
      return `drop_check ${op.check.name} on ${op.tableName}`;
    case "add_foreign_key":
      return `add_foreign_key ${op.foreignKey.name} on ${op.tableName}`;
    case "drop_foreign_key":
      return `drop_foreign_key ${op.foreignKey.name} on ${op.tableName}`;
    case "change_foreign_key_action":
      return (
        `change_foreign_key_action ${op.tableName}.${op.columnName} ` +
        `(ON DELETE ${op.fromOnDelete} -> ${op.toOnDelete}, ` +
        `ON UPDATE ${op.fromOnUpdate} -> ${op.toOnUpdate})`
      );
  }
}
