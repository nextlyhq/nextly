/**
 * The foreign keys a Schema Builder collection's table carries in the
 * desired schema.
 *
 * The Builder creates a table with each relationship's key, but every later
 * save goes through the push pipeline, whose desired schema described no key
 * at all. So a relationship added to an existing table got none, on any
 * dialect, and the keys a table did have were invisible to the diff. On
 * SQLite that was worst: a key lives only in `CREATE TABLE`, the push
 * rebuilds a table to change a column's type, and the rebuild was made from
 * a definition without the key, so it was dropped, or the whole save was
 * refused because drizzle-kit, reading the whole database, saw a key nothing
 * declared.
 *
 * The table's keys here are the ones its live table already holds, kept
 * while their columns remain, and the key of each relationship whose column
 * this push adds, described by the Builder's own rule
 * (`relationshipForeignKey`). A relationship the change adds whose column an
 * earlier apply already added counts as added: MySQL commits each schema
 * statement, so an apply refused part-way can leave the column without its
 * key. Nothing else: a relationship the registry already records whose
 * column has no key keeps it that way, so an existing install is planned no
 * new key it did not ask for, and a code-first collection is not touched.
 * A relationship the save renames keeps what its old column had: the keys are
 * planned before the save's renames are known, so its new column reads as
 * added, and `withoutKeysOnKeylessRenames` takes back a key its old column
 * never had. A rename an earlier apply already made (MySQL committed it, and a
 * later statement failed before the registry learned the new name) leaves no
 * rename to answer, so it is read from what the earlier apply left: a recorded
 * relationship gone from the change and from the live table, beside one the
 * registry does not record over a live column to the same table.
 *
 * @module domains/schema/pipeline/builder-foreign-keys
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { NextlyError } from "../../../errors/nextly-error";
import type { CollectionTables } from "../../dynamic-collections/services/collection-tables";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import {
  fieldProducesColumn,
  relationshipStoresJson,
  toSnakeCase,
} from "../services/field-column-descriptor";
import { relationshipTargetSlug } from "../services/relationship-key-target";

import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "./diff/types";
import type { DesiredCollection } from "./types";

export function withBuilderForeignKeys(
  spec: TableSpec,
  collection: DesiredCollection,
  live: TableSpec | undefined,
  dialect: SupportedDialect,
  // The table each collection is stored in, so a key to a renamed target references the one it kept.
  targetTables?: CollectionTables
): TableSpec {
  if (collection.builderOwned !== true) return spec;

  const lower = (name: string) => name.toLowerCase();
  const columns = new Set(spec.columns.map(column => lower(column.name)));
  const liveColumns = new Set(
    (live?.columns ?? []).map(column => lower(column.name))
  );
  const builder = new DynamicCollectionSchemaService(undefined, dialect);
  const fields = collection.fields as unknown as FieldDefinition[];
  const recordedFields = collection.recordedFields as
    | readonly FieldDefinition[]
    | undefined;
  // Without the recorded field list, every column already in place counts as recorded.
  const recorded =
    recordedFields === undefined
      ? undefined
      : new Set(recordedFields.map(field => field.name));
  // The tables a recorded relationship pointed at whose field the change no longer has and whose
  // column the live table no longer holds: an earlier apply moved that column, and an unrecorded
  // relationship to the same table over a column already in place is where it went. It is not
  // keyed, so the rename keeps what its old column had, as a rename this save answers does. A
  // drop and an add that the earlier apply made look the same, so that added relationship is left
  // without a key too, as it was before any of this.
  const desiredNames = new Set(fields.map(field => field.name));
  const movedFrom = new Set(
    (recordedFields ?? []).flatMap(field => {
      if (desiredNames.has(field.name)) return [];
      const described = builder.relationshipForeignKey(
        spec.name,
        field,
        false,
        targetTables
      );
      return described === null || liveColumns.has(lower(described.columns[0]))
        ? []
        : [lower(described.referencesTable)];
    })
  );

  // Refused before anything else is planned: a relationship whose column holds a key, pointed at
  // another collection or made to hold a list by this save (`refuseKeyedRelationshipChanges`).
  if (recordedFields !== undefined) {
    refuseKeyedRelationshipChanges(fields, recordedFields, live);
  }

  const kept = keptKeys(spec, fields, live, {
    builder,
    recordedFields,
    targetTables,
  });
  const keyed = new Set(kept.flatMap(fk => fk.columns.map(lower)));

  // Created: the key of each relationship whose column this push adds.
  const created: ForeignKeySpec[] = [];
  for (const field of fields) {
    // Read first without judging the actions: a relationship whose column
    // already exists keeps whatever it has, and a combination an older save
    // accepted (a required relationship that nulls on delete) must not block
    // every later save of the collection over a key nothing is creating.
    const described = builder.relationshipForeignKey(
      spec.name,
      field,
      false,
      targetTables
    );
    if (described === null) continue;
    const column = lower(described.columns[0]);
    const addedByThisChange =
      !liveColumns.has(column) ||
      (recorded !== undefined &&
        !recorded.has(field.name) &&
        !movedFrom.has(lower(described.referencesTable)));
    if (!columns.has(column) || !addedByThisChange || keyed.has(column)) {
      continue;
    }
    // A key this push creates is judged: what a save asks for has to be
    // possible, exactly as when the Builder creates the table.
    const fk = builder.relationshipForeignKey(
      spec.name,
      field,
      true,
      targetTables
    );
    if (fk !== null) created.push(fk);
  }

  return { ...spec, foreignKeys: [...kept, ...created] };
}

/**
 * The keys the live table holds that the desired table keeps: every one whose columns the table
 * keeps. A key over a column this push drops goes with the column, and so does one over a
 * relationship now holding a list: its column becomes JSON, which no key to one row can hold, so
 * the key is dropped (ahead of the conversion). A kept key takes the actions the save gives its
 * relationship (`withActionsTheSaveChanged`).
 */
function keptKeys(
  spec: TableSpec,
  fields: readonly FieldDefinition[],
  live: TableSpec | undefined,
  context: {
    builder: DynamicCollectionSchemaService;
    recordedFields: readonly FieldDefinition[] | undefined;
    targetTables: CollectionTables | undefined;
  }
): ForeignKeySpec[] {
  const lower = (name: string) => name.toLowerCase();
  const columns = new Set(spec.columns.map(column => lower(column.name)));
  const listColumns = new Set(
    fields
      .filter(field => relationshipStoresJson(field))
      .map(field => lower(toSnakeCase(field.name)))
  );
  const { builder, recordedFields, targetTables } = context;
  return (live?.foreignKeys ?? [])
    .filter(
      fk =>
        fk.columns.every(column => columns.has(lower(column))) &&
        !fk.columns.some(column => listColumns.has(lower(column)))
    )
    .map(fk =>
      recordedFields === undefined
        ? fk
        : withActionsTheSaveChanged(
            fk,
            spec.name,
            fields,
            recordedFields,
            builder,
            targetTables
          )
    );
}

/**
 * `fk` with the delete and update actions its relationship now declares, where this save changed
 * them from what the registry records, as the save's migration file changes them; the key keeps
 * its name and target. A relationship whose actions the save leaves as they were keeps its key
 * exactly as the table holds it, whatever its field would describe today.
 */
function withActionsTheSaveChanged(
  fk: ForeignKeySpec,
  table: string,
  fields: readonly FieldDefinition[],
  recordedFields: readonly FieldDefinition[],
  builder: DynamicCollectionSchemaService,
  targetTables: CollectionTables | undefined
): ForeignKeySpec {
  if (fk.columns.length !== 1) return fk;
  const column = fk.columns[0].toLowerCase();
  const field = fields.find(f => toSnakeCase(f.name).toLowerCase() === column);
  const before = recordedFields.find(f => f.name === field?.name);
  if (field === undefined || before === undefined) return fk;
  const now = builder.relationshipForeignKey(table, field, false, targetTables);
  const was = builder.relationshipForeignKey(
    table,
    before,
    false,
    targetTables
  );
  if (
    now === null ||
    was === null ||
    (now.onDelete === was.onDelete && now.onUpdate === was.onUpdate)
  ) {
    return fk;
  }
  // Judged, as a key this save creates is: what the save asks for has to be possible.
  const judged = builder.relationshipForeignKey(
    table,
    field,
    true,
    targetTables
  );
  return judged === null
    ? fk
    : { ...fk, onDelete: judged.onDelete, onUpdate: judged.onUpdate };
}

/** A field's name as an author reads it: its label where it has one. */
function fieldTitle(field: FieldDefinition): string {
  return typeof field.label === "string" && field.label.trim() !== ""
    ? field.label
    : field.name;
}

/**
 * Refuses a save that would leave a relationship's key checking the wrong collection.
 *
 * A relationship whose live column holds a foreign key has every value checked against its
 * target's table. Pointing it at another collection would keep that key checking the old target,
 * so every value of the new one would be refused. That is refused here, naming the field, before
 * any statement is planned, and the key stays as it is. Making it hold several entries is not:
 * that switch converts each value into a one-item list and takes the key with the conversion
 * (`keysDroppedBeforeConversions`), since no key can check a list. Judged against the fields the
 * registry records before this save, so only what the save changes is judged, and a relationship
 * whose column holds no key changes freely, as it always has.
 */
function refuseKeyedRelationshipChanges(
  fields: readonly FieldDefinition[],
  recordedFields: readonly FieldDefinition[],
  live: TableSpec | undefined
): void {
  const keyedColumns = new Set(
    (live?.foreignKeys ?? []).flatMap(fk =>
      fk.columns.length === 1 ? [fk.columns[0].toLowerCase()] : []
    )
  );
  if (keyedColumns.size === 0) return;
  const recordedByName = new Map(recordedFields.map(f => [f.name, f]));
  for (const field of fields) {
    const before = recordedByName.get(field.name);
    if (before === undefined) continue;
    if (!isKeyedRelationshipPair(field, before, keyedColumns)) continue;
    if (relationshipStoresJson(field)) continue;
    if (relationshipTargetSlug(field) === relationshipTargetSlug(before)) {
      continue;
    }
    throw targetChangeRefusal(field, before);
  }
}

/**
 * Whether `field` and its recorded definition `before` are both relationships with a column of
 * their own, and that column holds a key in the live table.
 */
function isKeyedRelationshipPair(
  field: FieldDefinition,
  before: FieldDefinition,
  keyedColumns: ReadonlySet<string>
): boolean {
  return (
    field.type === "relationship" &&
    before.type === "relationship" &&
    fieldProducesColumn(field) &&
    fieldProducesColumn(before) &&
    keyedColumns.has(toSnakeCase(field.name).toLowerCase())
  );
}

/** The refusal of pointing a keyed relationship at another collection, naming both. */
function targetChangeRefusal(
  field: FieldDefinition,
  before: FieldDefinition
): NextlyError {
  const target = relationshipTargetSlug(before) ?? "its collection";
  const next = relationshipTargetSlug(field);
  const named = next === null ? "another collection" : `"${next}"`;
  return keyedRelationshipRefusal(
    field,
    "KEYED_RELATIONSHIP_CANNOT_CHANGE_TARGET",
    `"${fieldTitle(field)}" can't be pointed at ${named}: the database checks every value it ` +
      `holds against "${target}". Add a new relationship field for ${named} instead, then ` +
      `remove this one.`
  );
}

function keyedRelationshipRefusal(
  field: FieldDefinition,
  code: string,
  message: string
): NextlyError {
  return NextlyError.validation({
    errors: [{ path: `fields.${field.name}`, code, message }],
    logContext: { field: field.name, reason: code },
  });
}

/**
 * The plan without a key on a Schema Builder relationship column that a
 * rename in this save gives a new name, when its old column had none.
 *
 * `withBuilderForeignKeys` plans keys as the desired snapshot is built, before
 * the save's renames are answered, so a renamed relationship reads as one the
 * change adds and its new column is keyed. Keying it is not the rename's to
 * do: rows that point at deleted entries would refuse the key, and its delete
 * action would start to fire. The key is taken back from both places it is
 * planned: the operations, from which keys are added by statement, and the
 * desired snapshot, from which a table SQLite rebuilds declares them. A
 * renamed column whose old one had a key keeps it, and a table the Builder
 * does not own keeps what its config declares.
 */
export function withoutKeysOnKeylessRenames(
  operations: Operation[],
  desired: NextlySchemaSnapshot,
  live: NextlySchemaSnapshot,
  builderTables: ReadonlySet<string>
): { operations: Operation[]; desired: NextlySchemaSnapshot } {
  const lower = (name: string) => name.toLowerCase();
  const keyedBefore = (table: string, column: string) =>
    (
      live.tables.find(t => lower(t.name) === lower(table))?.foreignKeys ?? []
    ).some(fk => fk.columns.some(c => lower(c) === lower(column)));
  const renamedKeyless = new Set(
    operations.flatMap(op =>
      op.type === "rename_column" &&
      builderTables.has(lower(op.tableName)) &&
      !keyedBefore(op.tableName, op.fromColumn)
        ? [`${lower(op.tableName)}.${lower(op.toColumn)}`]
        : []
    )
  );
  if (renamedKeyless.size === 0) return { operations, desired };
  const onRenamedKeyless = (table: string, fk: ForeignKeySpec) =>
    fk.columns.some(column =>
      renamedKeyless.has(`${lower(table)}.${lower(column)}`)
    );
  return {
    operations: operations.filter(
      op =>
        op.type !== "add_foreign_key" ||
        !onRenamedKeyless(op.tableName, op.foreignKey)
    ),
    desired: {
      ...desired,
      tables: desired.tables.map(table =>
        (table.foreignKeys ?? []).some(fk => onRenamedKeyless(table.name, fk))
          ? {
              ...table,
              foreignKeys: (table.foreignKeys ?? []).filter(
                fk => !onRenamedKeyless(table.name, fk)
              ),
            }
          : table
      ),
    },
  };
}
