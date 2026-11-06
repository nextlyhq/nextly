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

/**
 * The rows `read` lists, or none when it cannot: without them an apply switches nothing on SQLite,
 * which is what it did before any were read, and the apply itself is not held up.
 */
export async function registryRowsOrNone(
  read: () => Promise<readonly RegistryFieldsRow[] | undefined>
): Promise<readonly RegistryFieldsRow[]> {
  try {
    return (await read()) ?? [];
  } catch {
    return [];
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
