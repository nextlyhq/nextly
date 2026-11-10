/**
 * The fields a plugin's scope holds back from a type the site switched off,
 * and which of them a schema change keeps.
 *
 * A plugin that adds a field to every content type lets the site switch a
 * type off (`except`). The type then no longer declares the field, so the
 * API, the admin and every output stop showing it. Its column stays: a type
 * switched off after its column was made keeps the column and the values in
 * it, and gets them back when it is switched on again. Only `nextly prune`
 * drops them, with the data-loss consent. A type switched off before its
 * column was ever made gets none.
 *
 * The fold publishes what each switched-off type would have had
 * (`withheld-scope-fields.ts`). Every road a schema change takes reads it
 * here: dev push against the live tables, and `migrate:create` and
 * `migrate:check` against the last migration's snapshot.
 * A held-back field whose column is already there is added back to the type's
 * desired shape, so none of them plans a drop, and as optional, so a row
 * written while the type is off saves without it.
 *
 * @module domains/schema/pipeline/kept-scope-fields
 */

import type { FieldConfig } from "../../../collections/config/define-collection";
import type { SupportedDialect } from "../../../database/schema-registry";
import { companionTableOf } from "../../i18n/migration/derive-companion-spec";
import {
  columnsDeclaredBy,
  type ColumnOrigin,
} from "../services/field-column-descriptor";

import { buildDesiredTableFromFields } from "./diff/build-from-fields";
import { typesDiffer } from "./diff/declared-size";
import type { ColumnSpec, NextlySchemaSnapshot } from "./diff/types";
import type { DesiredSchema } from "./types";
import {
  currentWithheldScopeFields,
  withheldScopeFieldsOf,
  type ScopedKind,
} from "./withheld-scope-fields";

/** The columns a set of tables has, as a snapshot of them states them. */
export interface ExistingColumns {
  /** The names of each table's columns. */
  names: ReadonlyMap<string, ReadonlySet<string>>;
  /** Each column's declaration, where the snapshot states one. */
  specs: ReadonlyMap<string, ReadonlyMap<string, ColumnSpec>>;
  /** The dialect the declarations are in; absent, none is compared. */
  dialect?: SupportedDialect;
}

/** The columns each table of `snapshot` has. */
export function columnsByTable(
  snapshot: NextlySchemaSnapshot,
  dialect?: SupportedDialect
): ExistingColumns {
  const names = new Map<string, Set<string>>();
  const specs = new Map<string, Map<string, ColumnSpec>>();
  const add = (table: string, columns: readonly string[]) =>
    names.set(table, new Set([...(names.get(table) ?? []), ...columns]));
  for (const table of snapshot.tables) {
    add(
      table.name,
      table.columns.map(column => column.name)
    );
    specs.set(
      table.name,
      new Map(table.columns.map(column => [column.name, column]))
    );
    // A migration snapshot records a translated table's companion columns on
    // the main table, as `localizedColumns`, not as a table of its own.
    if (table.localizedColumns !== undefined) {
      add(companionTableOf(table.name), table.localizedColumns);
    }
  }
  return { names, specs, ...(dialect === undefined ? {} : { dialect }) };
}

interface TypeShape {
  slug: string;
  tableName: string;
  fields: readonly unknown[];
}

/** A field a scope adds, which always has a name: its column is named by it. */
type NamedField = FieldConfig & { name: string };

/**
 * The fields held back from `type` whose column `existing` already has, on
 * its own table or its translations', as optional. None when nothing is held
 * back or nothing of it was ever made.
 */
export function keptScopeFields(
  kind: ScopedKind,
  type: TypeShape,
  existing: ExistingColumns
): NamedField[] {
  const withheld = withheldScopeFieldsOf(kind, type.slug);
  if (withheld.length === 0) return [];
  const held = new Set([
    ...(existing.names.get(type.tableName) ?? []),
    ...(existing.names.get(companionTableOf(type.tableName)) ?? []),
  ]);
  // A type that declares a field of the name itself keeps its own, as does
  // one whose own field, spelled otherwise, is stored in the same column.
  const declared = new Set(
    type.fields.flatMap(field => {
      const name = (field as { name?: unknown }).name;
      return typeof name === "string" ? [name.toLowerCase()] : [];
    })
  );
  const claimed = columnsDeclaredBy(
    type.fields as Parameters<typeof columnsDeclaredBy>[0]
  );
  const candidates = withheld.filter((field): field is NamedField => {
    if (typeof field.name !== "string") return false;
    if (declared.has(field.name.toLowerCase())) return false;
    const columns = [...columnsDeclaredBy([field])];
    return (
      !columns.some(column => claimed.has(column)) &&
      columns.some(column => held.has(column))
    );
  });
  return onePerName(candidates, type.tableName, existing).map(asOptional);
}

/**
 * One field to a name. Several scopes can declare a field of one name, and
 * which of them made the column depends on which were switched off when it
 * was made, which nothing records. So the one kept is the one whose column is
 * the column there; the first, in the order the fold prefers them, when none
 * or more than one matches or nothing states the column.
 */
function onePerName(
  candidates: readonly NamedField[],
  tableName: string,
  existing: ExistingColumns
): NamedField[] {
  const byName = new Map<string, NamedField[]>();
  for (const field of candidates) {
    const name = field.name.toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), field]);
  }
  return [...byName.values()].map(
    fields =>
      fields.find(field => storedAsDeclared(field, tableName, existing)) ??
      fields[0]
  );
}

/**
 * Whether `field`'s columns are declared as the columns there, as the diff
 * compares them, built either way a type's columns are built.
 */
function storedAsDeclared(
  field: NamedField,
  tableName: string,
  existing: ExistingColumns
): boolean {
  const { dialect } = existing;
  const there = existing.specs.get(tableName);
  if (dialect === undefined || there === undefined) return false;
  const columns = columnsDeclaredBy([field]);
  const origins: ColumnOrigin[] = ["codeFirst", "collection"];
  return origins.some(builtBy =>
    buildDesiredTableFromFields(tableName, [field], dialect, { builtBy })
      .columns.filter(column => columns.has(column.name))
      .every(column => {
        const current = there.get(column.name);
        return current !== undefined && !typesDiffer(current, column);
      })
  );
}

/** `type` with its {@link keptScopeFields} added back. */
export function withKeptScopeFields<T extends TypeShape>(
  kind: ScopedKind,
  type: T,
  existing: ExistingColumns
): T {
  const kept = keptScopeFields(kind, type, existing);
  return kept.length === 0
    ? type
    : { ...type, fields: [...type.fields, ...kept] };
}

/** `desired` with every type's kept fields, judged against `live`. */
export function withKeptScopeFieldsIn(
  desired: DesiredSchema,
  live: NextlySchemaSnapshot,
  dialect: SupportedDialect
): DesiredSchema {
  const existing = columnsByTable(live, dialect);
  const keep = <T extends TypeShape>(
    kind: ScopedKind,
    types: Record<string, T>
  ): Record<string, T> =>
    Object.fromEntries(
      Object.entries(types).map(([slug, type]) => [
        slug,
        withKeptScopeFields(kind, type, existing),
      ])
    );
  return {
    ...desired,
    collections: keep("collection", desired.collections),
    singles: keep("single", desired.singles),
  };
}

// What the running site's tables were last built without, per type: the
// fields its scope held back then. A field moving between declared and kept
// changes no column, so a reload has nothing else to tell it the type's
// runtime tables must be built again, nor that its kept column must be
// relaxed.
const served = globalThis as unknown as {
  __nextly_servedHeldBack?: Map<string, string>;
};

const namesOf = (fields: readonly FieldConfig[]): string =>
  fields
    .flatMap(field =>
      typeof field.name === "string" ? [field.name.toLowerCase()] : []
    )
    .sort()
    .join(",");

/**
 * The types, by {@link scopedTypeKey}, whose held-back fields differ from what
 * the running site's tables were last built without: switched off or on since,
 * whether in the configuration or made in the Schema Builder. None recorded
 * reads as none held back, as a site starts: its tables are built from the
 * declared fields alone.
 */
export function heldBackChanges(): string[] {
  const now = currentWithheldScopeFields();
  const before = served.__nextly_servedHeldBack ?? new Map<string, string>();
  return [...new Set([...now.keys(), ...before.keys()])].filter(
    key => (before.get(key) ?? "") !== namesOf(now.get(key) ?? [])
  );
}

/** Records that the running site's tables for `keys` were built without what is held back now. */
export function noteHeldBackServed(keys: readonly string[]): void {
  const now = currentWithheldScopeFields();
  served.__nextly_servedHeldBack ??= new Map();
  for (const key of keys) {
    served.__nextly_servedHeldBack.set(key, namesOf(now.get(key) ?? []));
  }
}

/**
 * A kept field as the switched-off type stores it: never required, so its
 * column takes no value from a row written while the field is not shown.
 */
function asOptional(field: NamedField): NamedField {
  return "required" in field && field.required === true
    ? { ...field, required: false }
    : field;
}
