/**
 * The storage shape each relation column had before a change, written onto the live schema from
 * the registry's record of the fields.
 *
 * The diff plans a relation's switch from the shape it had to the shape it has
 * (`ColumnSpec.referenceShape`). A migration snapshot records both sides. A live table does not:
 * introspection reads the column's type, and the type does not always tell the shapes apart (SQLite
 * keeps one id, a list and a reference naming its collection all as text). What the field was is
 * in the registry's record of it, which every road that applies a change hands to the apply
 * (`recordedFields`), so each such column on the live side is given the shape its recorded field
 * stores. A column with no recorded field keeps none, and the diff then reads the type alone.
 *
 * @module domains/schema/pipeline/recorded-shapes
 */
import {
  relationshipStoresJson,
  relationStorageShape,
  toSnakeCase,
} from "../services/field-column-descriptor";
import { relationshipTargetSlug } from "../services/relationship-key-target";

import type { NextlySchemaSnapshot, TableSpec } from "./diff/types";
import type {
  DesiredCollection,
  DesiredFieldGroup,
  DesiredSchema,
  DesiredSingle,
} from "./types";

/** A collection, Single or field group of a desired schema, with what each reader asks of it. */
export interface RelationEntity {
  entity: DesiredCollection | DesiredSingle | DesiredFieldGroup;
  kind: "collection" | "single" | "fieldGroup";
  /** How a refusal names its kind. */
  label: "Collection" | "Single" | "Field group";
  /** A field group's row, where a many-to-many keeps its list. */
  component: boolean;
}

/** Every collection, Single and field group of `desired`. */
export function relationEntities(
  desired: Pick<DesiredSchema, "collections" | "singles" | "components">
): RelationEntity[] {
  return [
    ...Object.values(desired.collections).map(entity => ({
      entity,
      kind: "collection" as const,
      label: "Collection" as const,
      component: false,
    })),
    ...Object.values(desired.singles).map(entity => ({
      entity,
      kind: "single" as const,
      label: "Single" as const,
      component: false,
    })),
    ...Object.values(desired.components).map(entity => ({
      entity,
      kind: "fieldGroup" as const,
      label: "Field group" as const,
      component: true,
    })),
  ];
}

interface RecordedField {
  name?: unknown;
  type?: unknown;
  hasMany?: unknown;
  relationTo?: unknown;
  options?: unknown;
}

/** The shape each recorded relation's column stores, by table and column, lower-cased. */
function recordedShapes(
  desired: DesiredSchema
): Map<string, NonNullable<ReturnType<typeof relationStorageShape>>> {
  const shapes = new Map<
    string,
    NonNullable<ReturnType<typeof relationStorageShape>>
  >();
  for (const { entity, component } of relationEntities(desired)) {
    for (const field of (entity.recordedFields ??
      []) as readonly RecordedField[]) {
      if (typeof field.name !== "string") continue;
      const shape = relationStorageShape(field, component);
      if (shape === undefined) continue;
      shapes.set(
        `${entity.tableName.toLowerCase()}.${toSnakeCase(field.name).toLowerCase()}`,
        shape
      );
    }
  }
  return shapes;
}

/**
 * Whether a change of `before` into `after` reaches a relation's storage, which only the push
 * applies: a field kept by name that stores another shape now (one reference, a list, a reference
 * naming its collection, a list of those), or a field storing a list or such a reference whose live
 * column still carries a foreign key, as an older save left one reference's column.
 *
 * The push plans every such change from the live table: it counts the rows that refuse a switch
 * before anything runs, converts the values and repairs an older column, and SQLite drops a key
 * only by rebuilding the table. A Schema Builder save that writes its migration from the newest
 * snapshot sees none of that, so a save this answers true for is applied by the push and its file
 * recorded once it has run, as a translated collection's is. So is a relationship pointed at
 * another collection while its live column holds a key: the push judges the key against the live
 * table before anything runs. `liveTable` is read only where a field stores a list or a reference
 * naming its collection, or a relationship's target changes.
 */
export async function reachesRelationStorage(args: {
  before: readonly RecordedField[];
  after: readonly RecordedField[];
  liveTable: () => Promise<TableSpec | undefined>;
}): Promise<boolean> {
  // By column, as the push keys a relation's shape: two names that spell one column are one.
  const columnOf = (field: RecordedField) =>
    typeof field.name === "string"
      ? toSnakeCase(field.name).toLowerCase()
      : undefined;
  const shapeOf = (fields: readonly RecordedField[]) =>
    new Map(
      fields.flatMap(field => {
        const column = columnOf(field);
        const shape = relationStorageShape(field);
        return column !== undefined && shape !== undefined
          ? [[column, shape] as const]
          : [];
      })
    );
  const was = shapeOf(args.before);
  for (const [column, shape] of shapeOf(args.after)) {
    const before = was.get(column);
    if (before !== undefined && before !== shape) return true;
  }
  // The columns that keep no key to one row, by the one rule the push drops their keys by.
  const keyless = args.after.flatMap(field => {
    const column = columnOf(field);
    return column !== undefined && relationshipStoresJson(field)
      ? [column]
      : [];
  });
  // The columns of relationships this change points at another collection, as reads name it.
  const targetBefore = new Map(
    args.before.flatMap(field => {
      const column = columnOf(field);
      return column !== undefined && field.type === "relationship"
        ? [[column, relationshipTargetSlug(field)] as const]
        : [];
    })
  );
  const retargeted = args.after.flatMap(field => {
    const column = columnOf(field);
    return column !== undefined &&
      field.type === "relationship" &&
      targetBefore.has(column) &&
      targetBefore.get(column) !== relationshipTargetSlug(field)
      ? [column]
      : [];
  });
  const watched = [...keyless, ...retargeted];
  if (watched.length === 0) return false;
  const table = await args.liveTable();
  return (table?.foreignKeys ?? []).some(key =>
    key.columns.some(column => watched.includes(column.toLowerCase()))
  );
}

/** `live` with each recorded relation's column given the shape its field stored. */
export function withRecordedShapes(
  live: NextlySchemaSnapshot,
  desired: DesiredSchema
): NextlySchemaSnapshot {
  const shapes = recordedShapes(desired);
  if (shapes.size === 0) return live;
  return {
    ...live,
    tables: live.tables.map(table => ({
      ...table,
      columns: table.columns.map(column => {
        const shape = shapes.get(
          `${table.name.toLowerCase()}.${column.name.toLowerCase()}`
        );
        return shape === undefined
          ? column
          : { ...column, referenceShape: shape };
      }),
    })),
  };
}
