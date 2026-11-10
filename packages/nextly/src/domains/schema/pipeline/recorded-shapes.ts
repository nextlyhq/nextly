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
  relationStorageShape,
  toSnakeCase,
} from "../services/field-column-descriptor";

import type { NextlySchemaSnapshot } from "./diff/types";
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
