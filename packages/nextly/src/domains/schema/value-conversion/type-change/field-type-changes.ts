/**
 * The one judgement of a save's field type changes, which every road that changes a schema asks:
 * the fields whose type a save changes (`fieldTypeChangesOf`), each judged over the values its
 * column holds (`judgeFieldTypeChanges`), and the refusal a blocked change, or a lossy one the
 * owner has not consented to, gives (`typeChangeRefusals`). Every road asks it as a precondition,
 * before its first statement: the push (`pipeline/ui-type-changes`), the writer and a Single's save.
 *
 * @module domains/schema/value-conversion/type-change/field-type-changes
 */
import { NextlyError } from "../../../../errors/nextly-error";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { resolveLocalizedFieldNames } from "../../../i18n/classify-fields";
import { storesPerLanguage } from "../../../i18n/per-language-storage";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  type ColumnOrigin,
  fieldsStoredOnRow,
  getColumnDescriptor,
  type SupportedDialect,
} from "../../services/field-column-descriptor";
import { describeClassed } from "../describe";

import { type FieldTypeOnDialect, fieldTypeOnDialect } from "./field-type";
import {
  fieldAccepts,
  judgeStoredTypeChange,
  type StoredTypeChangeJudgement,
} from "./judge-stored";

/** One field whose type a save changes, read as the rules read both types on one database. */
export interface FieldTypeChange {
  /** The field as the save leaves it. */
  to: FieldDefinition;
  /** The field as the database holds it before the save. */
  from: FieldDefinition;
  fromType: FieldTypeOnDialect;
  toType: FieldTypeOnDialect;
}

/**
 * Whether two readings of a field are the same type for the rules: the family, the type's name,
 * and what decides a value's stored form (a number's format, a list's items, how a relationship
 * keeps its links). A column's width alone is not a type change; a one-to-one becoming many-to-one
 * keeps its links one per row, so it is not one either.
 */
function sameType(a: FieldTypeOnDialect, b: FieldTypeOnDialect): boolean {
  return (
    a.family === b.family &&
    a.type === b.type &&
    JSON.stringify(a.number) === JSON.stringify(b.number) &&
    sameItem(a.item, b.item) &&
    a.relation?.kept === b.relation?.kept
  );
}

/** A list's item type read by the same rule as the field's own: none on either side, or the same. */
function sameItem(
  a: FieldTypeOnDialect | undefined,
  b: FieldTypeOnDialect | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameType(a, b);
}

/**
 * The fields whose type a save changes, each paired with the field the database holds by its name,
 * or by the name a rename gives it. Only a field with a column before and after the save: one whose
 * values its column keeps and the new type then reads. A field that loses its column (a
 * relationship turned many-to-many, kept in a junction table) or gains one is a drop or an add,
 * which the save asks about as such.
 *
 * @param renamed the new name of each field the save renames, keyed by its old name
 */
export function fieldTypeChangesOf(args: {
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  renamed?: ReadonlyMap<string, string>;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): FieldTypeChange[] {
  const oldNameOf = new Map(
    [...(args.renamed ?? new Map<string, string>())].map(([from, to]) => [
      to,
      from,
    ])
  );
  // The fields kept on the row: a field inside a group with no name is one of them, by its own name.
  const byName = new Map(
    fieldsStoredOnRow(args.previous).map(field => [field.name, field])
  );
  const changes: FieldTypeChange[] = [];
  for (const to of fieldsStoredOnRow(args.next)) {
    const from = byName.get(oldNameOf.get(to.name) ?? to.name);
    if (from === undefined) continue;
    if (
      getColumnDescriptor(from, args.dialect, args.builtBy) === null ||
      getColumnDescriptor(to, args.dialect, args.builtBy) === null
    ) {
      continue;
    }
    const fromType = fieldTypeOnDialect(from, args.dialect, args.builtBy);
    const toType = fieldTypeOnDialect(to, args.dialect, args.builtBy);
    if (!sameType(fromType, toType)) {
      changes.push({ to, from, fromType, toType });
    }
  }
  return changes;
}

/** One field's type change judged over the values its column holds. */
export interface JudgedFieldTypeChange extends FieldTypeChange {
  table: string;
  column: string;
  result: StoredTypeChangeJudgement;
}

/**
 * Each change judged over its column: on the entity's table, or on its translations table, where
 * each language's value is its own row. The table the old definition keeps the value in is asked
 * first and the other after, so a save that also turns translation on or off reads each value where
 * it is. Each kept or changed value is asked of the new field's own validation too. A change whose
 * old column neither table has holds no value to judge, as where a save refused part-way already
 * took it (SQLite rebuilds a table to change a column), and is left out.
 *
 * @param translated the names of the fields kept per language before the save
 */
export async function judgeFieldTypeChanges(args: {
  db: unknown;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  table: string;
  translationsTable?: string;
  translated?: ReadonlySet<string>;
  changes: readonly FieldTypeChange[];
}): Promise<JudgedFieldTypeChange[]> {
  const judged: JudgedFieldTypeChange[] = [];
  const columnsOf = liveColumnReader(args.db, args.dialect);
  for (const change of args.changes) {
    const column = getColumnDescriptor(
      change.from,
      args.dialect,
      args.builtBy
    )?.name;
    if (column === undefined) continue;
    // Where the old definition keeps the value first, then the other table: a save that turns
    // translation on or off has each value where it was, which the column's presence tells.
    const translated =
      args.translationsTable !== undefined &&
      args.translated?.has(change.from.name) === true;
    const candidates = [args.table, args.translationsTable].filter(
      (t): t is string => t !== undefined
    );
    if (translated) candidates.reverse();
    let table: string | undefined;
    for (const candidate of candidates) {
      if ((await columnsOf(candidate)).has(column.toLowerCase())) {
        table = candidate;
        break;
      }
    }
    if (table === undefined) continue;
    const perLanguage = table === args.translationsTable;
    const result = await judgeStoredTypeChange({
      db: args.db,
      dialect: args.dialect,
      table,
      column,
      keyedBy: perLanguage ? "translation" : "id",
      from: change.fromType,
      to: change.toType,
      accepts: fieldAccepts(change.toType, change.to),
      // A unique field holds each value once: two that read as one value of the new type block.
      unique: change.to.unique === true,
    });
    judged.push({ ...change, table, column, result });
  }
  return judged;
}

/** Each table's column names, lower-cased, read from the database once per table. */
function liveColumnReader(
  db: unknown,
  dialect: SupportedDialect
): (table: string) => Promise<ReadonlySet<string>> {
  const read = new Map<string, Promise<ReadonlySet<string>>>();
  return table => {
    let columns = read.get(table);
    if (columns === undefined) {
      columns = introspectLiveSnapshot(db, dialect, [table]).then(
        live =>
          new Set(
            (
              live.tables.find(
                t => t.name.toLowerCase() === table.toLowerCase()
              )?.columns ?? []
            ).map(c => c.name.toLowerCase())
          )
      );
      read.set(table, columns);
    }
    return columns;
  };
}

/** One refusal of a save's field type change, as a validation error lists it. */
export interface TypeChangeRefusal {
  path: string;
  code: "TYPE_CHANGE_BLOCKED" | "TYPE_CHANGE_LOSES_VALUES";
  message: string;
}

/**
 * The refusals a save's judged type changes give: each blocked one, and each lossy one whose field
 * the owner has not consented to clearing values of (`acknowledged`, by field path). Each names the
 * field, both types and every reason with its rows, by key and never by value, and says that a new
 * field of the new type keeps the old values beside the new ones.
 */
export function typeChangeRefusals(
  entity: string,
  judged: readonly JudgedFieldTypeChange[],
  acknowledged: ReadonlySet<string> = new Set()
): TypeChangeRefusal[] {
  const refusals: TypeChangeRefusal[] = [];
  for (const change of judged) {
    const { judgement } = change.result;
    const blocked = judgement.class === "blocked";
    if (
      !blocked &&
      !(judgement.class === "lossy" && !acknowledged.has(change.to.name))
    ) {
      continue;
    }
    refusals.push({
      path: change.to.name,
      code: blocked ? "TYPE_CHANGE_BLOCKED" : "TYPE_CHANGE_LOSES_VALUES",
      message: `${entity}: field '${change.to.name}' cannot change from ${change.from.type} to ${change.to.type} (${describeClassed(judgement)}). A new field of the new type keeps the old values beside the new ones.`,
    });
  }
  return refusals;
}

/** The registry statuses whose recorded fields the database already has. */
const DEFINITION_APPLIED = new Set(["applied", "synced"]);

/**
 * The refusal of a save that changes a field's type while the entity's recorded definition still
 * awaits its migration (`migrationStatus` neither applied nor synced): its recorded fields describe
 * a future the columns do not hold yet, so no value can be judged against them. Null where nothing
 * changes type or the definition is the database's.
 */
export function pendingMigrationRefusal(
  entity: string,
  migrationStatus: string | null | undefined,
  changes: readonly FieldTypeChange[]
): TypeChangeRefusal | null {
  if (changes.length === 0) return null;
  if (DEFINITION_APPLIED.has(String(migrationStatus))) return null;
  return {
    path: changes[0].to.name,
    code: "TYPE_CHANGE_BLOCKED",
    message: `Finish the pending migration of ${entity} first, then change the field's type.`,
  };
}

/** How a refusal names each kind of entity a save changes. */
const KIND_LABEL = {
  collection: "Collection",
  single: "Single",
  fieldGroup: "Field group",
} as const;

/** How a refusal names an entity: "Collection 'products'", "Single 'home'". */
export function entityLabel(
  kind: keyof typeof KIND_LABEL,
  slug: string
): string {
  return `${KIND_LABEL[kind]} '${slug}'`;
}

/**
 * Where an entity's fields kept per language before a save have their values: its companion table,
 * for an entity stored per language (`storesPerLanguage`), with the fields its old definition
 * translates. Nothing for one that keeps every value on its main table.
 */
export function perLanguageBefore(
  entity: { localized?: unknown },
  table: string,
  previous: readonly FieldDefinition[]
): Pick<EntityTypeChangeInput, "translationsTable" | "translatedBefore"> {
  if (!storesPerLanguage(entity)) return {};
  return {
    translationsTable: `${table}_locales`,
    translatedBefore: new Set(
      resolveLocalizedFieldNames(fieldsStoredOnRow(previous), true)
    ),
  };
}

/** One entity a save changes, as the precondition reads it. */
export interface EntityTypeChangeInput {
  /** How a refusal names the entity: "Collection 'products'", "Single 'home'". */
  label: string;
  table: string;
  /** Its translations table, where a field translated before the save keeps each language's value. */
  translationsTable?: string;
  /** The fields translated before the save. */
  translatedBefore?: ReadonlySet<string>;
  /** The fields as the database holds them before the save: the registry row's. */
  previous: readonly FieldDefinition[];
  /** The fields as the save leaves them. */
  next: readonly FieldDefinition[];
  renamed?: ReadonlyMap<string, string>;
  /** The registry row's status: a definition still awaiting its migration is not judged against. */
  migrationStatus?: string | null;
  builtBy: ColumnOrigin;
  /** The fields whose lost values the owner consented to clearing, by name. */
  acknowledged?: ReadonlySet<string>;
}

/**
 * Every refusal of `entity`'s field type changes: each blocked one, each lossy one with no consent
 * naming its field, or the one refusal of any type change while the entity's definition still
 * awaits its migration. A save with no field type change reads no row.
 */
export async function fieldTypeChangeRefusals(
  db: unknown,
  dialect: SupportedDialect,
  entity: EntityTypeChangeInput
): Promise<TypeChangeRefusal[]> {
  const changes = fieldTypeChangesOf({
    previous: entity.previous,
    next: entity.next,
    ...(entity.renamed !== undefined ? { renamed: entity.renamed } : {}),
    dialect,
    builtBy: entity.builtBy,
  });
  if (changes.length === 0) return [];
  const pending =
    entity.migrationStatus === undefined
      ? null
      : pendingMigrationRefusal(entity.label, entity.migrationStatus, changes);
  if (pending !== null) return [pending];
  return typeChangeRefusals(
    entity.label,
    await judgeFieldTypeChanges({
      db,
      dialect,
      builtBy: entity.builtBy,
      table: entity.table,
      ...(entity.translationsTable !== undefined
        ? { translationsTable: entity.translationsTable }
        : {}),
      ...(entity.translatedBefore !== undefined
        ? { translated: entity.translatedBefore }
        : {}),
      changes,
    }),
    entity.acknowledged
  );
}

/** A refusal as a validation error lists it: by the field's path under `fields`. */
export function typeChangeError(refusal: TypeChangeRefusal): {
  path: string;
  code: string;
  message: string;
} {
  return {
    path: `fields.${refusal.path}`,
    code: refusal.code,
    message: refusal.message,
  };
}

/**
 * Refuse, before any statement of the save runs, every field type change of `entity` that is
 * blocked, or lossy with no consent naming its field, and any type change while the entity's
 * definition still awaits its migration (`fieldTypeChangeRefusals`). Every refusal is named at
 * once, so the owner sees them all in one save.
 *
 * @throws {NextlyError} a validation error listing each refusal by its field
 */
export async function refuseFieldTypeChanges(
  db: unknown,
  dialect: SupportedDialect,
  entity: EntityTypeChangeInput
): Promise<void> {
  const refusals = await fieldTypeChangeRefusals(db, dialect, entity);
  if (refusals.length === 0) return;
  throw NextlyError.validation({
    errors: refusals.map(typeChangeError),
    logContext: {
      entity: entity.label,
      fields: refusals.map(refusal => refusal.path),
    },
  });
}
