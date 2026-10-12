/**
 * A live table's shape as `readLiveElements` reads it, for unit tests that
 * hand the drop guard the database's state instead of reading it: each
 * column's type as the guard spells it (`"TEXT"`, `"INT"`), declared
 * nullable and without a default unless named otherwise, no unique
 * constraint and no trigger unless given.
 */
import type { LiveTableShape } from "../drop-guard";

export function liveShape(
  types: Record<string, string>,
  over: {
    primaryKey?: string[];
    notNull?: string[];
    defaults?: Record<string, string>;
    unique?: string[];
    triggers?: number;
  } = {}
): LiveTableShape {
  return {
    columns: new Map(
      Object.entries(types).map(([name, type]) => [
        name,
        {
          type,
          notNull: over.notNull?.includes(name) ?? false,
          default: over.defaults?.[name],
        },
      ])
    ),
    primaryKey: [...(over.primaryKey ?? ["id"])].sort(),
    unique: new Set(over.unique ?? []),
    triggers: over.triggers ?? 0,
  };
}
