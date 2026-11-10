/**
 * A migration written for one entity: what `generateMigration` reads and
 * writes when it is given a `scope`.
 *
 * A Schema Builder save writes the migration for the entity it saved, and only
 * that. Whatever else changed since the latest snapshot — a code-first
 * collection dev push already changed, an extension table — is neither in the
 * file nor in its snapshot, so the next `migrate:create` still sees it as a
 * change and writes it. So every table outside the scope stands in the new
 * snapshot as the latest one recorded it, and the settings record keeps every
 * other entity's entry as it was.
 *
 * @module domains/schema/migrate-create/scope
 */
import type {
  ContributedElements,
  NextlySchemaSnapshot,
  TableSpec,
} from "../pipeline/diff/types";

import type { AppStreamSnapshots } from "./app-stream";
import type {
  EntitySettingsChange,
  EntitySettingsRecord,
  SettingsEntityKind,
} from "./entity-settings";

/** The one entity a migration is written for. */
export interface GenerateScope {
  kind: SettingsEntityKind;
  slug: string;
  /**
   * Every table the entity owns, before the change and after it: its own and
   * its junctions. A table it no longer owns is dropped only when it is here.
   */
  tables: ReadonlySet<string>;
}

/** Where each kind's entries sit in a settings record. */
const RECORD_KEY: Record<SettingsEntityKind, keyof EntitySettingsRecord> = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
};

/**
 * `tables` with every table outside the scope as `outside` holds it: one
 * `outside` has is kept as it is there, and one it lacks is left out. The
 * scoped tables come from `tables`, in place where `outside` has them and
 * after the rest where they are new.
 */
function withOutsideFrom(
  scope: GenerateScope,
  tables: readonly TableSpec[],
  outside: readonly TableSpec[]
): TableSpec[] {
  const scoped = new Map(
    tables.filter(t => scope.tables.has(t.name)).map(t => [t.name, t])
  );
  const kept: TableSpec[] = [];
  for (const table of outside) {
    if (!scope.tables.has(table.name)) {
      kept.push(table);
      continue;
    }
    const now = scoped.get(table.name);
    if (now !== undefined) kept.push(now);
    scoped.delete(table.name);
  }
  return [...kept, ...scoped.values()];
}

/**
 * The app stream's three snapshots with every table outside the scope frozen:
 * the desired side is the previous side there, so the diff sees no change to
 * it, and the written snapshot holds the latest snapshot file's copy, so the
 * file records it unchanged. The contributions to a table outside the scope
 * are the latest file's.
 */
export function scopedStream(
  scope: GenerateScope,
  stream: AppStreamSnapshots,
  latest: {
    snapshot: NextlySchemaSnapshot;
    contributions?: Record<string, ContributedElements>;
  }
): AppStreamSnapshots {
  const contributions: Record<string, ContributedElements> = {};
  for (const [table, elements] of Object.entries(latest.contributions ?? {})) {
    if (!scope.tables.has(table)) contributions[table] = elements;
  }
  for (const [table, elements] of Object.entries(stream.contributions)) {
    if (scope.tables.has(table)) contributions[table] = elements;
  }
  return {
    previous: stream.previous,
    desired: {
      ...stream.desired,
      tables: withOutsideFrom(
        scope,
        stream.desired.tables,
        stream.previous.tables
      ),
    },
    written: {
      ...stream.written,
      tables: withOutsideFrom(
        scope,
        stream.written.tables,
        latest.snapshot.tables
      ),
    },
    contributions,
  };
}

/**
 * The settings record a scoped migration writes: the latest snapshot's, with
 * the scoped entity's entry as `desired` has it, or removed where `desired`
 * has none. Undefined only where neither record exists.
 */
export function scopedSettingsRecord(
  scope: GenerateScope,
  latest: EntitySettingsRecord | undefined,
  desired: EntitySettingsRecord | undefined
): EntitySettingsRecord | undefined {
  const key = RECORD_KEY[scope.kind];
  const entry = desired?.[key][scope.slug];
  if (latest === undefined && entry === undefined) return undefined;
  const record: EntitySettingsRecord = {
    collections: { ...latest?.collections },
    singles: { ...latest?.singles },
    fieldGroups: { ...latest?.fieldGroups },
  };
  const entries = { ...record[key] };
  delete entries[scope.slug];
  if (entry !== undefined) entries[scope.slug] = entry;
  record[key] = entries;
  return record;
}

/** The settings changes of the scoped entity alone. */
export function scopedSettingsChanges(
  scope: GenerateScope,
  changes: readonly EntitySettingsChange[]
): EntitySettingsChange[] {
  return changes.filter(
    change => change.kind === scope.kind && change.slug === scope.slug
  );
}
