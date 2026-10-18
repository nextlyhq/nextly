/**
 * Main-table columns whose values a save has already moved to the entity's companion: the fields
 * that become translated, whose values are now the default language's. The push still drops each
 * from the main table, which is where the field no longer lives, but nothing is lost by it.
 *
 * So the drop is judged as what it is. It is not a rename source, since the column went to the
 * companion rather than to another main column, and it asks for no confirmation of data loss.
 * The preview and the apply read the same list, so the dialog never asks for a confirmation the
 * apply would not need.
 *
 * @module domains/schema/pipeline/moved-to-companion
 */
import type { Operation } from "./diff/types";

export interface ColumnMovedToCompanion {
  tableName: string;
  columnName: string;
}

/**
 * The operations the rename detector and the classifier judge: all of them except the drops of
 * columns moved to the companion. Those drops still run; only the judging leaves them out.
 */
export function operationsToJudge(
  operations: readonly Operation[],
  moved: readonly ColumnMovedToCompanion[] | undefined
): Operation[] {
  if (!moved?.length) return [...operations];
  const keys = new Set(moved.map(c => `${c.tableName}::${c.columnName}`));
  return operations.filter(
    op =>
      op.type !== "drop_column" ||
      !keys.has(`${op.tableName}::${op.columnName}`)
  );
}
