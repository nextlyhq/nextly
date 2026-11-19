/**
 * A Schema Builder save's field type changes, refused before the push runs anything: each entity
 * the save states its old fields for (`recordedFields`) is judged, value by value, against the
 * fields it saves (`refuseFieldTypeChanges`). A blocked change, or a lossy one the owner has not
 * consented to, refuses the whole save with every refusal named, before any statement runs. A
 * locked entity is code's, and the save changes none of its columns.
 *
 * A field that keeps its name is judged before the push plans anything (`refuseUiTypeChanges`); a
 * field the save renames is judged once the renames are answered (`refuseRenamedUiTypeChanges`),
 * since only the answers say which old column the new field's values come from.
 *
 * @module domains/schema/pipeline/ui-type-changes
 */
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  fieldsStoredOnRow,
  type SupportedDialect,
} from "../services/field-column-descriptor";
import {
  type ColumnAt,
  columnDescriptorAt,
} from "../value-conversion/type-change/field-type";
import {
  entityLabel,
  type EntityTypeChangeInput,
  perLanguageBefore,
  refuseFieldTypeChanges,
} from "../value-conversion/type-change/field-type-changes";

import { introspectLiveSnapshot } from "./diff/introspect-live";
import { builtByFor } from "./registered-collections";
import type {
  DesiredCollection,
  DesiredFieldGroup,
  DesiredSchema,
  DesiredSingle,
} from "./types";

type EntityKind = "collection" | "single" | "fieldGroup";

interface SavedEntity {
  kind: EntityKind;
  entity: DesiredCollection | DesiredSingle | DesiredFieldGroup;
  /** The fields the registry records for it before the save. */
  previous: FieldDefinition[];
  /** The fields as the save leaves them. */
  next: FieldDefinition[];
}

/** The entities the save states its old fields for and may change: none of code's. */
function builderSaved(desired: DesiredSchema): SavedEntity[] {
  const all: { kind: EntityKind; entity: SavedEntity["entity"] }[] = [
    ...Object.values(desired.collections).map(entity => ({
      kind: "collection" as const,
      entity,
    })),
    ...Object.values(desired.singles).map(entity => ({
      kind: "single" as const,
      entity,
    })),
    ...Object.values(desired.components).map(entity => ({
      kind: "fieldGroup" as const,
      entity,
    })),
  ];
  return all.flatMap(({ kind, entity }) =>
    entity.recordedFields === undefined || entity.locked === true
      ? []
      : [
          {
            kind,
            entity,
            previous: entity.recordedFields as unknown as FieldDefinition[],
            next: entity.fields as unknown as FieldDefinition[],
          },
        ]
  );
}

/** What the precondition reads of one saved entity, besides the fields it judges. */
function entityInput(
  saved: SavedEntity
): Omit<EntityTypeChangeInput, "previous" | "next" | "renamed"> {
  const { kind, entity, previous } = saved;
  return {
    label: entityLabel(kind, entity.slug),
    table: entity.tableName,
    // A field translated before the save keeps each language's value in the companion table. The
    // desired entity says whether it is translated after the save; a save that turns translation
    // on or off has the values where they were, so the companion is always named and each value is
    // read from whichever of the two tables holds its column.
    translationsTable: `${entity.tableName}_locales`,
    ...perLanguageBefore(entity, entity.tableName, previous),
    builtBy: builtByFor(kind, entity.builderOwned),
    // A field group keeps its fields on its component rows, where a many-to-many has a column.
    ...(kind === "fieldGroup" ? { componentRow: true } : {}),
  };
}

/**
 * Refuse the save's blocked and unconsented lossy type changes of fields that keep their names,
 * entity by entity.
 *
 * @throws {NextlyError} a validation error naming each refused field of the first entity that has
 *   one
 */
export async function refuseUiTypeChanges(
  desired: DesiredSchema,
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  for (const saved of builderSaved(desired)) {
    const input = entityInput(saved);
    const renamed = await landedRenames(saved, input, db, dialect);
    await refuseFieldTypeChanges(db, dialect, {
      ...input,
      previous: saved.previous,
      next: saved.next,
      ...(renamed.size > 0 ? { renamed } : {}),
    });
  }
}

/**
 * A rename an earlier apply already made: MySQL commits a rename on its own, so an apply refused
 * after it and before the type change that followed leaves the field's old values under its new
 * name. Found where the save drops one recorded field and adds one new field, and the table has
 * the new one's column and not the old one's; then the new field is judged as the old one's type
 * change. Anything else names no rename, and reads no table.
 */
async function landedRenames(
  saved: SavedEntity,
  // Where the entity keeps its fields, which decides each one's column (`columnDescriptorAt`).
  at: ColumnAt,
  db: unknown,
  dialect: SupportedDialect
): Promise<Map<string, string>> {
  const previous = fieldsStoredOnRow(saved.previous);
  const next = fieldsStoredOnRow(saved.next);
  const nextNames = new Set(next.map(f => f.name));
  const previousNames = new Set(previous.map(f => f.name));
  const dropped = previous.filter(f => !nextNames.has(f.name));
  const added = next.filter(f => !previousNames.has(f.name));
  if (dropped.length === 0 || added.length === 0) return new Map();
  const live = await introspectLiveSnapshot(db, dialect, [
    saved.entity.tableName,
  ]);
  const columns = new Set(
    (live.tables[0]?.columns ?? []).map(c => c.name.toLowerCase())
  );
  const has = (field: FieldDefinition) =>
    columns.has(
      columnDescriptorAt(field, dialect, at)?.name.toLowerCase() ?? ""
    );
  const gone = dropped.filter(f => !has(f));
  const landed = added.filter(has);
  const [from] = gone;
  const [to] = landed;
  return gone.length === 1 && landed.length === 1 && from && to
    ? new Map([[from.name, to.name]])
    : new Map();
}

/** A rename the save's answers confirmed, by table and column. */
export interface ConfirmedColumnRename {
  tableName: string;
  fromColumn: string;
  toColumn: string;
}

/**
 * Refuse the blocked and unconsented lossy type changes of fields the save renames, judged once
 * the renames are answered and before anything runs: the rename carries the old column's values to
 * the new name, where the new type then reads them. Only the renamed fields are judged here; the
 * rest were judged before the push planned anything (`refuseUiTypeChanges`).
 *
 * @throws {NextlyError} a validation error naming each refused field of the first entity that has
 *   one
 */
export async function refuseRenamedUiTypeChanges(
  source: "ui" | "code",
  desired: DesiredSchema,
  renames: readonly ConfirmedColumnRename[],
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  // A code-first apply's type changes are judged by its own rule, in the classifier.
  if (source !== "ui" || renames.length === 0) return;
  for (const saved of builderSaved(desired)) {
    const input = entityInput(saved);
    const columnOf = (field: FieldDefinition) =>
      columnDescriptorAt(field, dialect, input)?.name.toLowerCase();
    // The entity's own table, or its companion for a translated field's rename.
    const tables = new Set(
      [saved.entity.tableName, `${saved.entity.tableName}_locales`].map(t =>
        t.toLowerCase()
      )
    );
    const previous = fieldsStoredOnRow(saved.previous);
    const next = fieldsStoredOnRow(saved.next);
    const renamed = renamedFieldsOf(previous, next, renames, tables, columnOf);
    if (renamed.size === 0) continue;
    const newNames = new Set(renamed.values());
    await refuseFieldTypeChanges(db, dialect, {
      ...input,
      previous: previous.filter(f => renamed.has(f.name)),
      next: next.filter(f => newNames.has(f.name)),
      renamed,
    });
  }
}

/**
 * The fields the confirmed renames name, old name to new, among the fields kept on the row: a field
 * a group with no name holds is one of them by its own name. A rename on another table, or one that
 * names no field on either side, names none.
 *
 * @param tables the tables, lower-cased, whose renames are this entity's
 * @param columnOf a field's column name, lower-cased
 */
export function renamedFieldsOf(
  previous: readonly FieldDefinition[],
  next: readonly FieldDefinition[],
  renames: readonly ConfirmedColumnRename[],
  tables: ReadonlySet<string>,
  columnOf: (field: FieldDefinition) => string | undefined
): Map<string, string> {
  const renamed = new Map<string, string>();
  const previousOnRow = fieldsStoredOnRow(previous);
  const nextOnRow = fieldsStoredOnRow(next);
  for (const rename of renames) {
    if (!tables.has(rename.tableName.toLowerCase())) continue;
    const from = previousOnRow.find(
      f => columnOf(f) === rename.fromColumn.toLowerCase()
    );
    const to = nextOnRow.find(
      f => columnOf(f) === rename.toColumn.toLowerCase()
    );
    if (from !== undefined && to !== undefined && from.name !== to.name) {
      renamed.set(from.name, to.name);
    }
  }
  return renamed;
}
