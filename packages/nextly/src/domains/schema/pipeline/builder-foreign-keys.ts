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
  fieldsStoredOnRow,
  relationshipStoresJson,
  toSnakeCase,
} from "../services/field-column-descriptor";
import { movedForeignKeyName } from "../services/index-name";
import { relationshipTargetSlug } from "../services/relationship-key-target";

import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "./diff/types";
import type { DesiredCollection } from "./types";

/**
 * The recorded fields whose columns sit on the row (`fieldsStoredOnRow`), or undefined where none
 * were recorded, which keeps its own meaning below.
 */
function recordedRowFields(
  fields: DesiredCollection["recordedFields"]
): FieldDefinition[] | undefined {
  return fields === undefined
    ? undefined
    : fieldsStoredOnRow(fields as unknown as FieldDefinition[]);
}

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
  // The fields whose columns sit on the row, before and after, those inside a group with no name
  // among them (`fieldsStoredOnRow`): a relationship there is a column of this table, keyed as the
  // creating SQL keys it, and the group itself has no column to key.
  const fields = fieldsStoredOnRow(
    collection.fields as unknown as FieldDefinition[]
  );
  const recordedFields = recordedRowFields(collection.recordedFields);
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

  // A keyed relationship this save points at another collection moves its key there
  // (`keyedRelationshipMoves`): planned here, judged against the rows before anything runs.
  const moves =
    recordedFields === undefined
      ? new Map<string, ForeignKeySpec>()
      : keyedRelationshipMoves(
          spec.name,
          fields,
          recordedFields,
          live,
          builder,
          targetTables
        );

  const kept = keptKeys(spec, fields, live, {
    builder,
    recordedFields,
    targetTables,
  })
    // A moved relationship's key is replaced by the one to its new target.
    .map(fk =>
      fk.columns.length === 1 ? (moves.get(lower(fk.columns[0])) ?? fk) : fk
    );
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
 * The keys a save moves: each relationship whose live column holds a foreign key and that the save
 * points at another collection, by its column, with the key it moves to.
 *
 * A relationship whose live column holds a key has every value checked against its target's
 * table, so pointing it elsewhere moves the key there: the new key is described as the Builder
 * describes one, under the name that lets it be added before the old one is dropped
 * (`movedForeignKeyName`), and the values are judged against the new target before anything runs
 * (`refuseKeysRowsWouldBreak`). A target with no table a key can point at (a Single, a slug that
 * names nothing) is refused here, naming the field, and the key stays. Making a keyed relationship
 * hold several entries is not a move: that switch converts each value into a one-item list and the
 * key goes with the conversion (`keysDroppedBeforeConversions`). Judged against the fields the
 * registry records before this save, so a relationship whose column holds no key changes freely.
 */
function keyedRelationshipMoves(
  table: string,
  fields: readonly FieldDefinition[],
  recordedFields: readonly FieldDefinition[],
  live: TableSpec | undefined,
  builder: DynamicCollectionSchemaService,
  targetTables: CollectionTables | undefined
): Map<string, ForeignKeySpec> {
  const lower = (name: string) => name.toLowerCase();
  const moves = new Map<string, ForeignKeySpec>();
  const liveKeys = new Map(
    (live?.foreignKeys ?? []).flatMap(fk =>
      fk.columns.length === 1 ? [[lower(fk.columns[0]), fk] as const] : []
    )
  );
  if (liveKeys.size === 0) return moves;
  const keyedColumns = new Set(liveKeys.keys());
  const recordedByName = new Map(recordedFields.map(f => [f.name, f]));
  for (const field of fields) {
    const before = recordedByName.get(field.name);
    const column = lower(toSnakeCase(field.name));
    const liveKey = liveKeys.get(column);
    if (before === undefined || liveKey === undefined) continue;
    if (!isKeyedRelationshipPair(field, before, keyedColumns)) continue;
    if (relationshipStoresJson(field)) continue;
    if (relationshipTargetSlug(field) === relationshipTargetSlug(before)) {
      continue;
    }
    moves.set(
      column,
      movedKey(table, field, liveKey, { fields, live, builder, targetTables })
    );
  }
  return moves;
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

/**
 * The key `field` moves to from `liveKey`: described as the Builder describes one, judged, under the
 * name that lets it be added before the old one is dropped. A target with no table is refused.
 */
function movedKey(
  table: string,
  field: FieldDefinition,
  liveKey: ForeignKeySpec,
  context: {
    fields: readonly FieldDefinition[];
    live: TableSpec | undefined;
    builder: DynamicCollectionSchemaService;
    targetTables: CollectionTables | undefined;
  }
): ForeignKeySpec {
  const { fields, live, builder, targetTables } = context;
  const moved = builder.relationshipForeignKey(
    table,
    field,
    true,
    targetTables
  );
  if (moved === null) throw targetWithoutTableRefusal(field);
  const column = toSnakeCase(field.name).toLowerCase();
  return {
    ...moved,
    name: movedForeignKeyName(
      table,
      column,
      liveKey.name,
      moved.referencesTable,
      otherKeyNames(table, column, fields, live, builder, targetTables)
    ),
  };
}

/**
 * The names the table's keys on columns other than `column` hold, live or as their relationships
 * describe them, which a moved key's name must not take.
 */
function otherKeyNames(
  table: string,
  column: string,
  fields: readonly FieldDefinition[],
  live: TableSpec | undefined,
  builder: DynamicCollectionSchemaService,
  targetTables: CollectionTables | undefined
): Set<string> {
  const other = (columns: readonly string[]) =>
    !columns.some(c => c.toLowerCase() === column);
  return new Set([
    ...(live?.foreignKeys ?? [])
      .filter(fk => other(fk.columns))
      .map(fk => fk.name),
    ...fields.flatMap(field => {
      const key = builder.relationshipForeignKey(
        table,
        field,
        false,
        targetTables
      );
      return key !== null && other(key.columns) ? [key.name] : [];
    }),
  ]);
}

/** The refusal of pointing a keyed relationship at a target with no table a key can check. */
function targetWithoutTableRefusal(field: FieldDefinition): NextlyError {
  const next = relationshipTargetSlug(field);
  const target = next === null ? "another collection" : `"${next}"`;
  return keyedRelationshipRefusal(
    field,
    "KEYED_RELATIONSHIP_TARGET_HAS_NO_TABLE",
    `"${fieldTitle(field)}" can't be pointed at ${target}: the database checks every value it ` +
      `holds, and ${target} has no table to check them against. Add a new relationship field ` +
      `for it instead, then remove this one.`
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
