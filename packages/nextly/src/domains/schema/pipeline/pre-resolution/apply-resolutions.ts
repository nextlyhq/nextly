// applyResolutionsToOperations - the bridge between rename detection and
// pre-resolution execution.
//
// Input:
//   - ops: the diff output (drop_column + add_column pairs the rename
//          detector flagged as candidates, plus all the other ops)
//   - resolutions: the user's choice per candidate from the prompt
//                  dispatcher: "rename" (merge into rename_column) or
//                  "drop_and_add" (preserve original drop+add)
//
// Output: an updated Operation[] where confirmed renames are merged into
// single rename_column ops. The pre-resolution executor (executor.ts) then
// runs the appropriate SQL.
//
// Defensive behavior:
//   - Resolution targeting a non-existent (drop, add) pair is ignored
//     (orphan resolutions don't crash; they leave the ops unchanged).
//   - Cross-table resolutions don't merge ops from different tables.
//   - Duplicate resolutions (same drop matched twice) only consume the
//     pair once; subsequent matches no-op.

import type {
  AddColumnOp,
  DropColumnOp,
  Operation,
  RenameColumnOp,
} from "../diff/types.js";

export interface RenameResolution {
  tableName: string;
  fromColumn: string;
  toColumn: string;
  choice: "rename" | "drop_and_add";
}

export function applyResolutionsToOperations(
  ops: Operation[],
  resolutions: RenameResolution[]
): Operation[] {
  // Only resolutions with choice 'rename' merge ops; drop_and_add is the
  // "leave drops/adds alone" choice.
  const renamesToApply = resolutions.filter(r => r.choice === "rename");
  if (renamesToApply.length === 0) return ops;

  // Pre-index the ops we might consume so lookups are O(1).
  // Use Sets of indices so we can mark ops as "consumed" without mutating
  // the input array.
  const dropIndexByKey = new Map<string, number>();
  const addIndexByKey = new Map<string, number>();
  ops.forEach((op, i) => {
    if (op.type === "drop_column") {
      dropIndexByKey.set(keyDrop(op), i);
    } else if (op.type === "add_column") {
      addIndexByKey.set(keyAdd(op), i);
    }
  });

  const consumed = new Set<number>();
  const renameOps: RenameColumnOp[] = [];

  for (const r of renamesToApply) {
    const dropKey = `${r.tableName}::${r.fromColumn}`;
    const addKey = `${r.tableName}::${r.toColumn}`;
    const dropIdx = dropIndexByKey.get(dropKey);
    const addIdx = addIndexByKey.get(addKey);

    // Defensive: orphan resolution where one or both sides don't exist.
    // Skip without consuming or merging - the originals (if any) survive.
    if (dropIdx === undefined || addIdx === undefined) continue;
    if (consumed.has(dropIdx) || consumed.has(addIdx)) continue;

    const dropOp = ops[dropIdx] as DropColumnOp;
    const addOp = ops[addIdx] as AddColumnOp;

    consumed.add(dropIdx);
    consumed.add(addIdx);

    renameOps.push({
      type: "rename_column",
      tableName: r.tableName,
      fromColumn: r.fromColumn,
      toColumn: r.toColumn,
      fromType: dropOp.columnType,
      toType: addOp.column.type,
    });
  }

  // Reconstruct: keep all non-consumed ops in their original order,
  // append the new rename_column ops at the end.
  const out: Operation[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (!consumed.has(i)) out.push(ops[i]);
  }
  out.push(...renameOps);
  return out;
}

function keyDrop(op: DropColumnOp): string {
  return `${op.tableName}::${op.columnName}`;
}

function keyAdd(op: AddColumnOp): string {
  return `${op.tableName}::${op.column.name}`;
}
