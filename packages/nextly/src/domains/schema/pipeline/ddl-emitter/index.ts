import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { Operation } from "../diff/types";

import { emitAdditiveDdl } from "./additive";
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

// Op types the fast path can handle on SQLite and MySQL — the purely
// additive subset. change_* ops stay with drizzle-kit there: SQLite
// implements them as a whole-table rebuild and MySQL as a full MODIFY
// COLUMN definition, both of which the kit already owns correctly.
const ADDITIVE_FAST_PATH_OP_TYPES = new Set<Operation["type"]>([
  "add_column",
  "add_table",
  "add_index",
  "drop_index",
]);

/**
 * Decide whether this apply's operations can ALL be emitted by the fast
 * in-memory DDL emitter for the given dialect. Conservative: any op
 * outside the dialect's supported set routes the whole apply back to
 * drizzle-kit (the existing slow path).
 *
 * An empty op list takes the fast path (which emits nothing) on EVERY
 * dialect rather than calling drizzle-kit. Letting drizzle-kit handle a
 * "no ops" apply means it runs its own catalog re-introspection + rename
 * heuristics against the full live DB and can act on drift the diff
 * engine explicitly decided was not there. Two observed failure modes:
 * on Postgres it emitted a destructive `DROP INDEX "<table>_pkey"` for
 * an unrelated managed table after a metadata-only field-type change
 * (`textarea` -> `richText`, both stored as `text`); on SQLite/MySQL —
 * where the kit has NO introspection filter — any live table absent from
 * the desired schema (UI-created entities, `_locales` companions) reads
 * as "deleted" and, paired against a "created" table, crashes the v1
 * rename resolver (`resolver(table) was called without a HintsHandler`).
 * Trusting our own diff for "is any DDL needed?" closes both surfaces.
 */
export function canEmitWithoutDrizzleKit(
  ops: Operation[],
  dialect: SupportedDialect
): boolean {
  if (ops.length === 0) return true;
  if (dialect === "postgresql") {
    return ops.every(op => FAST_PATH_OP_TYPES.has(op.type));
  }
  return ops.every(op => ADDITIVE_FAST_PATH_OP_TYPES.has(op.type));
}

/**
 * Emit the SQL statements for a fast-path-eligible operation list.
 * Precondition: canEmitWithoutDrizzleKit(ops, dialect) === true — except
 * for the pipeline's kit-path add_table pre-creation, which may pass a
 * pure add_table subset of a mixed op list on SQLite/MySQL.
 */
export function emitDdl(ops: Operation[], dialect: SupportedDialect): string[] {
  if (dialect === "postgresql") {
    return ops.flatMap(op => emitPostgresDdl(op));
  }
  // `dialect` is narrowed to "mysql" | "sqlite" here — exactly AdditiveDialect.
  return ops.flatMap(op => emitAdditiveDdl(op, dialect));
}
