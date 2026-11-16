/**
 * The registry's record of each code-first entity's fields from before an apply, handed to that
 * apply.
 *
 * A Schema Builder save states what it changes from (`recordedFields`). The roads that apply
 * configuration in code — a reload under `next dev`, `nextly db:sync` — read the new fields from
 * the configuration and update the registry row as well, so they read the row first. On SQLite a
 * relationship switched between one related entry and many is told by nothing else: its column is
 * text either way (`withRecordedShapes`).
 *
 * @module domains/schema/pipeline/recorded-fields
 */
import type { FieldConfig } from "../../../collections/config/define-collection";
import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../../field-groups/migration/target";

/** A registry row, as each registry service lists it. */
export interface RegistryFieldsRow {
  slug?: unknown;
  fields?: unknown;
}

/**
 * Gives each entity of `entities` whose slug `rows` lists the fields that row records, as its
 * `recordedFields`. An entity the Schema Builder owns, or one already stating what it changes from,
 * is left as it is: its save stated that itself.
 */
export function recordFieldsOnto(
  entities: Record<
    string,
    { builderOwned?: boolean; recordedFields?: readonly FieldConfig[] }
  >,
  rows: readonly RegistryFieldsRow[]
): void {
  for (const row of rows) {
    if (typeof row.slug !== "string" || !Array.isArray(row.fields)) continue;
    const entity = entities[row.slug];
    if (entity === undefined || entity.builderOwned === true) continue;
    if (entity.recordedFields !== undefined) continue;
    entity.recordedFields = row.fields as FieldConfig[];
  }
}

/** The registry tables each kind of entity is recorded in, by the names a database may hold. */
const REGISTRY_TABLES = {
  collections: ["dynamic_collections"],
  singles: ["dynamic_singles"],
  // Before and after the field-group storage migration, spelled by the storage catalog.
  components: [STORAGE_FORMAT.registryTable, MIGRATION_TARGET.registryTable],
} as const;

/**
 * The rows `read` lists. Read before a change replaces them, they are the only record of what a
 * relation stored on SQLite, so a read that fails refuses the change rather than letting it run
 * with no history: the switch it would have converted is left unconverted and then forgotten once
 * the registry records the new fields. A registry that does not exist yet, as on a database being
 * set up, holds no history to lose, and reads as empty.
 *
 * @throws NextlyError (validation, `RELATION_HISTORY_UNREADABLE`) when the registry is there and
 *   could not be read
 */
export async function registryRows(
  read: () => Promise<readonly RegistryFieldsRow[] | undefined>,
  registry: {
    kind: keyof typeof REGISTRY_TABLES;
    tableExists: (name: string) => Promise<boolean>;
  }
): Promise<readonly RegistryFieldsRow[]> {
  try {
    return (await read()) ?? [];
  } catch (error) {
    const present = await Promise.all(
      REGISTRY_TABLES[registry.kind].map(name =>
        registry.tableExists(name).catch(() => true)
      )
    );
    if (!present.some(Boolean)) return [];
    throw NextlyError.validation({
      errors: [
        {
          path: registry.kind,
          code: "RELATION_HISTORY_UNREADABLE",
          message:
            `The ${registry.kind} registry could not be read, so what each relationship stored ` +
            `before this change is unknown and a switch between one related entry and many could ` +
            `not be converted. Nothing was changed; try again.`,
        },
      ],
      cause: error instanceof Error ? error : undefined,
      logContext: {
        reason: "relation-history-unreadable",
        kind: registry.kind,
      },
    });
  }
}

/** The code-first rows a development start read before its registry syncs. */
export interface RecordedAtStart {
  collections: readonly RegistryFieldsRow[];
  singles: readonly RegistryFieldsRow[];
  components: readonly RegistryFieldsRow[];
}

let heldAtStart: RecordedAtStart | undefined;

/**
 * Holds the rows a development start read before its registry syncs replaced them, for the
 * apply that start runs next (`runBootTimeApplyIfDev`, through the configuration reload). By then
 * the rows already record the configuration's fields, so only these say what the fields were.
 */
export function holdRecordedAtStart(rows: RecordedAtStart): void {
  heldAtStart = rows;
}

/** The rows a start held, once: the apply that takes them is the one they were read for. */
export function takeRecordedAtStart(): RecordedAtStart | undefined {
  const rows = heldAtStart;
  heldAtStart = undefined;
  return rows;
}
