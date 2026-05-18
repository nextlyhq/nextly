import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { Operation } from "../diff/types";

import { emitPostgresDdl } from "./postgres";

// Op types the fast path can currently handle end-to-end. Grows one
// entry per implementation task. The four pre-resolution-handled types
// (rename_table/rename_column/drop_column/drop_table) are intentionally
// NOT here yet — they are added in a later task once mixed-scenario
// behavior is verified, because their presence means the apply also
// touched destructive/rename territory and we want to be conservative
// until tested.
const FAST_PATH_OP_TYPES = new Set<Operation["type"]>([
  "add_column",
  "add_table",
]);

/**
 * Decide whether this apply's operations can ALL be emitted by the fast
 * in-memory PostgreSQL DDL emitter. Conservative: any single op outside
 * the supported set, any non-postgresql dialect, or an empty op list
 * routes the whole apply back to drizzle-kit (the existing slow path).
 */
export function canEmitWithoutDrizzleKit(
  ops: Operation[],
  dialect: SupportedDialect
): boolean {
  if (dialect !== "postgresql") return false;
  if (ops.length === 0) return false;
  return ops.every(op => FAST_PATH_OP_TYPES.has(op.type));
}

/**
 * Emit the SQL statements for a fast-path-eligible operation list.
 * Precondition: canEmitWithoutDrizzleKit(ops, "postgresql") === true.
 */
export function emitDdl(ops: Operation[], dialect: SupportedDialect): string[] {
  if (dialect !== "postgresql") {
    throw new Error(
      `emitDdl: unsupported dialect "${dialect}" (fast path is PostgreSQL-only)`
    );
  }
  return ops.flatMap(op => emitPostgresDdl(op));
}
