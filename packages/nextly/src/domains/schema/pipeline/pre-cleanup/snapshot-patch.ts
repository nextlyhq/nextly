// For make_optional resolutions: produce a patched desired schema snapshot
// where the affected column stays nullable, so the next pushSchema call
// doesn't emit SET NOT NULL. Cleaner than filtering pushSchema's output.
//
// Pure functions; never mutate their inputs.

import type { NextlySchemaSnapshot, Operation } from "../diff/types";
import type { ClassifierEvent, Resolution } from "../resolution/types";

/**
 * The (table, column) pairs a make_optional resolution set targets, keyed by
 * event id. Shared by the snapshot, desired-schema, and operation patches so
 * the three views of "which column stays nullable" can never disagree.
 */
function makeOptionalTargets(
  resolutions: Resolution[],
  events: ClassifierEvent[]
): Map<string, { table: string; column: string }> {
  const makeOptionalEventIds = new Set(
    resolutions.filter(r => r.kind === "make_optional").map(r => r.eventId)
  );
  const targets = new Map<string, { table: string; column: string }>();
  if (makeOptionalEventIds.size === 0) return targets;
  for (const event of events) {
    if (
      makeOptionalEventIds.has(event.id) &&
      (event.kind === "add_not_null_with_nulls" ||
        event.kind === "add_required_field_no_default")
    ) {
      targets.set(event.id, {
        table: event.tableName,
        column: event.columnName,
      });
    }
  }
  return targets;
}

export function applyMakeOptionalToSnapshot(
  snapshot: NextlySchemaSnapshot,
  resolutions: Resolution[],
  events: ClassifierEvent[]
): NextlySchemaSnapshot {
  // type_change events are skipped defensively since make_optional doesn't
  // apply to them (applicableResolutions excludes it at classifier level).
  const targets = makeOptionalTargets(resolutions, events);
  if (targets.size === 0) return snapshot;

  return {
    tables: snapshot.tables.map(table => {
      const matchingTargets = [...targets.values()].filter(
        t => t.table === table.name
      );
      if (matchingTargets.length === 0) return table;
      return {
        ...table,
        columns: table.columns.map(col => {
          const matched = matchingTargets.some(t => t.column === col.name);
          return matched ? { ...col, nullable: true } : col;
        }),
      };
    }),
  };
}

/**
 * The operation-level counterpart of {@link applyMakeOptionalToSnapshot}: a
 * copy of `ops` where every `add_column` targeted by a make_optional
 * resolution carries a nullable column spec.
 *
 * The desired-schema patch alone only reaches the drizzle-kit path (its SQL
 * is rebuilt from the patched schema). The fast-path DDL emitters generate
 * their SQL from the OPERATIONS, so an unpatched add_column would still say
 * NOT NULL — failing the apply on a populated table (SQLite/MySQL) or
 * creating the column as required despite the admin's explicit resolution.
 */
export function applyMakeOptionalToOperations(
  ops: readonly Operation[],
  resolutions: Resolution[],
  events: ClassifierEvent[]
): Operation[] {
  const targets = makeOptionalTargets(resolutions, events);
  if (targets.size === 0) return [...ops];

  return ops.map(op => {
    if (op.type !== "add_column") return op;
    const matched = [...targets.values()].some(
      t => t.table === op.tableName && t.column === op.column.name
    );
    if (!matched) return op;
    return { ...op, column: { ...op.column, nullable: true } };
  });
}
