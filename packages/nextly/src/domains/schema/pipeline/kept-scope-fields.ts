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
import { companionTableOf } from "../../i18n/migration/derive-companion-spec";
import { columnsDeclaredBy } from "../services/field-column-descriptor";

import type { NextlySchemaSnapshot } from "./diff/types";
import type { DesiredSchema } from "./types";
import {
  currentWithheldScopeFields,
  withheldScopeFieldsOf,
  type ScopedKind,
} from "./withheld-scope-fields";

/** The names of the columns each table has, from a snapshot. */
export function columnsByTable(
  snapshot: NextlySchemaSnapshot
): ReadonlyMap<string, ReadonlySet<string>> {
  const columns = new Map<string, Set<string>>();
  const add = (table: string, names: readonly string[]) =>
    columns.set(table, new Set([...(columns.get(table) ?? []), ...names]));
  for (const table of snapshot.tables) {
    add(
      table.name,
      table.columns.map(column => column.name)
    );
    // A migration snapshot records a translated table's companion columns on
    // the main table, as `localizedColumns`, not as a table of its own.
    if (table.localizedColumns !== undefined) {
      add(companionTableOf(table.name), table.localizedColumns);
    }
  }
  return columns;
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
  existing: ReadonlyMap<string, ReadonlySet<string>>
): NamedField[] {
  const withheld = withheldScopeFieldsOf(kind, type.slug);
  if (withheld.length === 0) return [];
  const held = new Set([
    ...(existing.get(type.tableName) ?? []),
    ...(existing.get(companionTableOf(type.tableName)) ?? []),
  ]);
  // A type that declares a field of the name itself keeps its own.
  const declared = new Set(
    type.fields.flatMap(field => {
      const name = (field as { name?: unknown }).name;
      return typeof name === "string" ? [name.toLowerCase()] : [];
    })
  );
  return withheld
    .filter(
      (field): field is NamedField =>
        typeof field.name === "string" &&
        !declared.has(field.name.toLowerCase()) &&
        [...columnsDeclaredBy([field])].some(column => held.has(column))
    )
    .map(asOptional);
}

/** `type` with its {@link keptScopeFields} added back. */
export function withKeptScopeFields<T extends TypeShape>(
  kind: ScopedKind,
  type: T,
  existing: ReadonlyMap<string, ReadonlySet<string>>
): T {
  const kept = keptScopeFields(kind, type, existing);
  return kept.length === 0
    ? type
    : { ...type, fields: [...type.fields, ...kept] };
}

/** `desired` with every type's kept fields, judged against `live`. */
export function withKeptScopeFieldsIn(
  desired: DesiredSchema,
  live: NextlySchemaSnapshot
): DesiredSchema {
  const existing = columnsByTable(live);
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
