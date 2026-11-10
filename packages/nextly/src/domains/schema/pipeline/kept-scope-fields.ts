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
 * The fold publishes what each switched-off type would have had. Every road a
 * schema change takes reads it here: dev push against the live tables, and
 * `migrate:create` and `migrate:check` against the last migration's snapshot.
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

/** The kinds of type a scope reaches. */
export type ScopedKind = "collection" | "single";

/** The held-back fields, by {@link scopedTypeKey}. */
export type WithheldScopeFields = ReadonlyMap<string, readonly FieldConfig[]>;

/** The key one type's held-back fields are published under. */
export function scopedTypeKey(kind: ScopedKind, slug: string): string {
  return `${kind}:${slug}`;
}

// On `globalThis`, as the per-language storage choice is: Next.js can
// evaluate this module in more than one server module graph, and the fold
// that publishes may run in a different one from the push that reads.
const store = globalThis as unknown as {
  __nextly_withheldScopeFields?: WithheldScopeFields;
};

/**
 * Publish what the latest fold held back. Replaces what an earlier fold
 * published, so a type switched on again is no longer read as held back.
 */
export function publishWithheldScopeFields(
  withheld: WithheldScopeFields
): void {
  store.__nextly_withheldScopeFields = withheld;
}

/** The names of the columns each table has, from a snapshot. */
export function columnsByTable(
  snapshot: NextlySchemaSnapshot
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    snapshot.tables.map(table => [
      table.name,
      new Set(table.columns.map(column => column.name)),
    ])
  );
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
  const withheld = store.__nextly_withheldScopeFields?.get(
    scopedTypeKey(kind, type.slug)
  );
  if (withheld === undefined || withheld.length === 0) return [];
  const held = new Set([
    ...(existing.get(type.tableName) ?? []),
    ...(existing.get(companionTableOf(type.tableName)) ?? []),
  ]);
  return withheld
    .filter(
      (field): field is NamedField =>
        typeof field.name === "string" &&
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

// What the running site's tables were last built with, per type: a field
// moving between declared and kept changes no column, so a reload has nothing
// else to tell it the runtime tables must be built again.
const served = globalThis as unknown as {
  __nextly_servedKeptScopeFields?: Map<string, string>;
};

/**
 * Whether `kept` differs from what the running site's tables were last built
 * with for this type. None recorded reads as none kept, as a site starts:
 * its tables are built from the declared fields alone.
 */
export function keptScopeFieldsChanged(
  kind: ScopedKind,
  slug: string,
  kept: readonly string[]
): boolean {
  const before =
    served.__nextly_servedKeptScopeFields?.get(scopedTypeKey(kind, slug)) ?? "";
  return before !== [...kept].sort().join(",");
}

/** Records that the running site's tables for this type were built with `kept`. */
export function noteKeptScopeFieldsServed(
  kind: ScopedKind,
  slug: string,
  kept: readonly string[]
): void {
  served.__nextly_servedKeptScopeFields ??= new Map();
  served.__nextly_servedKeptScopeFields.set(
    scopedTypeKey(kind, slug),
    [...kept].sort().join(",")
  );
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
