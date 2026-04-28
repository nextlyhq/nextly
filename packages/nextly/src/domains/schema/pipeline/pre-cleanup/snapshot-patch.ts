// For make_optional resolutions: produce a patched desired schema snapshot
// where the affected column stays nullable, so the next pushSchema call
// doesn't emit SET NOT NULL. Cleaner than filtering pushSchema's output.
//
// Pure function; never mutates the input snapshot.

import type { NextlySchemaSnapshot } from "../diff/types.js";
import type { ClassifierEvent, Resolution } from "../resolution/types.js";

export function applyMakeOptionalToSnapshot(
  snapshot: NextlySchemaSnapshot,
  resolutions: Resolution[],
  events: ClassifierEvent[]
): NextlySchemaSnapshot {
  const makeOptionalEventIds = new Set(
    resolutions.filter(r => r.kind === "make_optional").map(r => r.eventId)
  );
  if (makeOptionalEventIds.size === 0) return snapshot;

  // Map eventId -> { table, column } for the kinds that own a column.
  // type_change events are skipped defensively since make_optional doesn't
  // apply to them (applicableResolutions excludes it at classifier level).
  const targets = new Map<string, { table: string; column: string }>();
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
