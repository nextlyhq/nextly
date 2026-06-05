import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { Operation } from "../diff/types";

import { emitPostgresDdl } from "./postgres";

// Op types the fast path can handle end-to-end on PostgreSQL.
//
// The four pre-resolution-handled types
// (rename_table / rename_column / drop_column / drop_table) are
// intentionally NOT here — they are owned by `executePreResolutionOps`,
// which runs before this routing decision; the emitter returns an
// empty string list for them so a stray inclusion would still be a
// no-op rather than a double-apply.
//
// The three change_* ops are explicitly listed here because punting
// them to drizzle-kit's pushSchema caused the silent-skip class of
// bugs in the rext-site-v2 / dc_case_studies incident: drizzle-kit
// considered `text` → `jsonb` a non-implicit cast and emitted zero
// SQL, while the journal still recorded the apply as successful.
// Owning the SQL here removes the silent-skip surface entirely —
// the change either runs (logged in the journal) or fails loudly
// when Postgres rejects the cast.
const FAST_PATH_OP_TYPES = new Set<Operation["type"]>([
  "add_column",
  "add_table",
  "change_column_type",
  "change_column_nullable",
  "change_column_default",
  "add_index",
  "drop_index",
]);

/**
 * Decide whether this apply's operations can ALL be emitted by the fast
 * in-memory PostgreSQL DDL emitter. Conservative: any op outside the
 * supported set, or any non-postgresql dialect, routes the whole apply
 * back to drizzle-kit (the existing slow path).
 *
 * Empty op list on Postgres ALSO takes the fast path (which emits
 * nothing) rather than calling drizzle-kit. Letting drizzle-kit handle
 * a "no ops" apply means it runs its own catalog re-introspection +
 * rename heuristics against the full live DB and can emit destructive
 * DDL the diff engine explicitly decided was not needed — e.g. a
 * metadata-only field-type change (`textarea` -> `richText`, both
 * stored as `text`) produced zero column-level ops here, but drizzle-
 * kit's pushSchema then emitted `DROP INDEX "<table>_pkey"` for an
 * unrelated managed table, which Postgres rejects because you cannot
 * drop a primary-key index directly. Trusting our own diff for "is
 * any DDL needed?" closes that surface.
 */
export function canEmitWithoutDrizzleKit(
  ops: Operation[],
  dialect: SupportedDialect
): boolean {
  if (dialect !== "postgresql") return false;
  if (ops.length === 0) return true;
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
