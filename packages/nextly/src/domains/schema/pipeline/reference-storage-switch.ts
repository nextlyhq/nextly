/**
 * A relation switched between one related entry and many, on a dialect where its column's type
 * is the same either way.
 *
 * SQLite stores a bare id and a JSON list of ids alike as text, so comparing the live column with
 * the desired one shows no change, and the stored values would stay in the shape the field no
 * longer has. What does change is the field, and the registry records the field as it was before
 * the save (`DesiredCollection.recordedFields`). This marks the column the switch touches, so the
 * diff plans the same conversion the dialects that retype the column plan (`referenceList` or
 * `referenceScalar`), with the type unchanged, and the apply orders it, refuses a list of several
 * ids for one, and runs it as it does theirs.
 *
 * Only a single-target relation's switch is marked: its values are bare ids either way. A relation
 * naming several targets holds `{ relationTo, value }` references, which neither conversion makes;
 * a switch to or from one is found by `targetSwitches` and refused while a row holds a value.
 *
 * @module domains/schema/pipeline/reference-storage-switch
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  relationshipStoresJson,
  toSnakeCase,
} from "../services/field-column-descriptor";

import type { TableSpec } from "./diff/types";
import type { DesiredCollection, DesiredSchema, DesiredSingle } from "./types";

/** A collection or Single: its fields, and the registry's record of them before the change. */
type RecordedEntity = Pick<
  DesiredCollection | DesiredSingle,
  "fields" | "recordedFields"
>;

interface ReferenceFieldShape {
  name?: unknown;
  type?: unknown;
  hasMany?: unknown;
  relationTo?: unknown;
}

/** A single-target relationship or upload: one id, or a list of ids, per row. */
function singleTarget(field: ReferenceFieldShape): boolean {
  return (
    (field.type === "relationship" || field.type === "upload") &&
    !Array.isArray(field.relationTo)
  );
}

/** The registry's recorded fields of `entity`, by name: what each field was before the save. */
function recordedByName(
  entity: RecordedEntity
): Map<string, ReferenceFieldShape> | undefined {
  const recordedFields = entity.recordedFields as
    | readonly ReferenceFieldShape[]
    | undefined;
  if (recordedFields === undefined) return undefined;
  return new Map(
    recordedFields.flatMap(field =>
      typeof field.name === "string" ? [[field.name, field] as const] : []
    )
  );
}

/** A relation switched between storage shapes no conversion moves values across. */
export interface TargetSwitch {
  tableName: string;
  columnName: string;
  /** The entity and field, as a refusal names them. */
  label: string;
  field: string;
}

/**
 * Each relation a save switches to or from naming several target collections, or between one
 * entry and many while it names several: its values are `{ relationTo, value }` references on one
 * side and something else on the other, which no conversion makes or reads back. Read from the
 * registry's recorded fields, so the same switch is found on every dialect.
 */
export function targetSwitches(desired: DesiredSchema): TargetSwitch[] {
  const entities = [
    ...Object.values(desired.collections).map(e => ["Collection", e] as const),
    ...Object.values(desired.singles).map(e => ["Single", e] as const),
  ];
  return entities.flatMap(([kind, entity]) => {
    const before = recordedByName(entity);
    if (before === undefined) return [];
    return (entity.fields as readonly ReferenceFieldShape[]).flatMap(field =>
      typeof field.name === "string" &&
      switchesTargets(before.get(field.name), field)
        ? [
            {
              tableName: entity.tableName,
              columnName: toSnakeCase(field.name),
              label: `${kind} '${entity.slug}'`,
              field: field.name,
            },
          ]
        : []
    );
  });
}

/**
 * Whether a relation recorded as `was` becomes, as `now`, one whose values have another shape no
 * conversion makes: to or from naming several targets, or between one entry and many while it
 * names several.
 */
function switchesTargets(
  was: ReferenceFieldShape | undefined,
  now: ReferenceFieldShape
): boolean {
  if (was === undefined || was.type !== now.type) return false;
  if (now.type !== "relationship" && now.type !== "upload") return false;
  const severalBefore = !singleTarget(was);
  const severalNow = !singleTarget(now);
  return (
    severalBefore !== severalNow ||
    (severalNow && Boolean(was.hasMany) !== Boolean(now.hasMany))
  );
}

/**
 * How a single-target relation recorded as `was` switches by becoming `now`: to a list, back to one
 * reference, or not at all (a field the save adds, one that changed type, one naming several
 * targets on either side, or one whose storage stayed).
 */
function singleTargetSwitch(
  was: ReferenceFieldShape | undefined,
  now: ReferenceFieldShape
): "toList" | "toScalar" | undefined {
  if (was === undefined || was.type !== now.type) return undefined;
  if (!singleTarget(now) || !singleTarget(was)) return undefined;
  const listBefore = relationshipStoresJson(was);
  const listNow = relationshipStoresJson(now);
  if (listBefore === listNow) return undefined;
  return listNow ? "toList" : "toScalar";
}

/**
 * `spec` with each column whose relation the save switches between one entry and many marked
 * `switchesReferenceStorage`. Unchanged where the dialect retypes the column (the type change is
 * the signal there) or where the registry's previous fields are not known.
 */
export function withReferenceStorageSwitches(
  spec: TableSpec,
  entity: RecordedEntity,
  dialect: SupportedDialect
): TableSpec {
  if (dialect !== "sqlite") return spec;
  const before = recordedByName(entity);
  if (before === undefined) return spec;

  const switches = new Map<string, "toList" | "toScalar">();
  for (const field of entity.fields as readonly ReferenceFieldShape[]) {
    if (typeof field.name !== "string") continue;
    const switched = singleTargetSwitch(before.get(field.name), field);
    if (switched !== undefined) {
      switches.set(toSnakeCase(field.name).toLowerCase(), switched);
    }
  }
  if (switches.size === 0) return spec;

  return {
    ...spec,
    columns: spec.columns.map(column => {
      const switched = switches.get(column.name.toLowerCase());
      return switched === undefined
        ? column
        : { ...column, switchesReferenceStorage: switched };
    }),
  };
}
