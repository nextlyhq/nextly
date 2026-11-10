/**
 * The relationships stored field configurations declare, and what renaming the collection they
 * point at does to them.
 *
 * A Builder-made collection, Single or field group keeps each relationship's target as a slug in
 * its registry row's stored `fields`: `relationTo`, one slug or, for a polymorphic field, a list,
 * and the Builder shape's `options.target`. A rename keeps every table name, so a relationship
 * resolves under the new slug once its stored target names it. The rename rewrites those targets
 * in its own transaction (`moveRelationshipTargets`), at any depth of groups and repeaters.
 *
 * It first refuses what it cannot move (`refuseUnmovableTargets`):
 * - a polymorphic field listing the collection: every value it stores names the target's slug,
 *   in tables of any size;
 * - a field of an entity its code defines: the stored fields are its config's, which a rename
 *   cannot change, and the next boot would write the old target back;
 * - a field that already names the new slug: it names no collection now, and would quietly start
 *   resolving to the renamed one.
 *
 * Only a collection can be a relationship's target, so a Single's rename touches none of this.
 *
 * @module domains/entity-rename/relationship-targets
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../collections/fields/types";
import { NextlyError } from "../../errors";
import { isRecord, subFieldsOf } from "../field-groups/field-group-instances";
import { calculateSchemaHash } from "../schema/services/schema-hash";

import { fieldsOf } from "./many-to-many-links";
import type { EntitySlugMove } from "./move-entity-slug";
import { storedFieldConfigurationTables } from "./slug-columns";

/** A registry row as this reads it. */
interface RegistryRow {
  id: unknown;
  slug: unknown;
  source: unknown;
  fields: unknown;
  schemaVersion: unknown;
}

/** One stored field that names relationship targets, and where it is. */
export interface TargetingField {
  /** `<entity>.<field>`, a nested field's path dotted: `posts.meta.editor`. */
  name: string;
  /** Who made the entity holding it: `ui` for the Schema Builder. */
  source: string;
  targets: string[];
  polymorphic: boolean;
}

/** A non-empty string. */
function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The slugs one field names as targets: its `relationTo`, and the Builder shape's target. */
function targetsOf(
  field: Record<string, unknown>
): Pick<TargetingField, "targets" | "polymorphic"> {
  const relationTo = field.relationTo;
  const listed = Array.isArray(relationTo)
    ? relationTo.filter(isSlug)
    : isSlug(relationTo)
      ? [relationTo]
      : [];
  const target = isRecord(field.options) ? field.options.target : undefined;
  return {
    targets: isSlug(target) ? [...listed, target] : listed,
    polymorphic: Array.isArray(relationTo),
  };
}

/** Calls `visit` with every field of `fields`, nested ones after their container. */
function visitFields(
  fields: readonly unknown[],
  path: string,
  visit: (field: Record<string, unknown>, name: string) => void
): void {
  for (const field of fields) {
    if (!isRecord(field)) continue;
    const name = `${path}.${isSlug(field.name) ? field.name : "?"}`;
    visit(field, name);
    const nested = subFieldsOf(field as FieldConfig);
    if (nested) visitFields(nested, name, visit);
  }
}

/** Every field the rows store that names a relationship target. */
export function targetingFields(
  rows: readonly Pick<RegistryRow, "slug" | "source" | "fields">[]
): TargetingField[] {
  const found: TargetingField[] = [];
  for (const row of rows) {
    if (!isSlug(row.slug)) continue;
    const source = isSlug(row.source) ? row.source : "ui";
    visitFields(fieldsOf(row.fields), row.slug, (field, name) => {
      const named = targetsOf(field);
      if (named.targets.length > 0) found.push({ name, source, ...named });
    });
  }
  return found;
}

/**
 * The fields of `fields` with every `relationTo` and `options.target` equal to `from` naming `to`
 * instead, at any depth; null when none names `from`. A list (`relationTo` of a polymorphic field)
 * is left as it is: the rename refuses before it gets here while one lists `from`.
 */
export function retargeted(
  fields: readonly unknown[],
  from: string,
  to: string
): unknown[] | null {
  let changed = false;
  const visit = (list: readonly unknown[]): unknown[] =>
    list.map(field => {
      if (!isRecord(field)) return field;
      const next = retargetedField(field, from, to);
      if (next !== field) changed = true;
      const nested = subFieldsOf(next as FieldConfig);
      return nested ? { ...next, fields: visit(nested) } : next;
    });
  const result = visit(fields);
  return changed ? result : null;
}

/** One field with its own targets equal to `from` naming `to`; the same object when none does. */
function retargetedField(
  field: Record<string, unknown>,
  from: string,
  to: string
): Record<string, unknown> {
  let next = field;
  if (field.relationTo === from) next = { ...next, relationTo: to };
  if (isRecord(field.options) && field.options.target === from) {
    next = { ...next, options: { ...field.options, target: to } };
  }
  return next;
}

/** The field-configuration registries this database has, each read whole on `tx`. */
async function registryRows(
  tx: TransactionContext,
  present: ReadonlySet<string>
): Promise<Array<{ table: string; rows: RegistryRow[] }>> {
  const read: Array<{ table: string; rows: RegistryRow[] }> = [];
  // Under each name a registry can have, so one whose storage is migrated is read too.
  for (const table of storedFieldConfigurationTables()) {
    if (!present.has(table)) continue;
    const rows = await tx.select<RegistryRow>(table, {
      columns: ["id", "slug", "source", "fields", "schemaVersion"],
    });
    read.push({ table, rows });
  }
  return read;
}

/** A stored schema version, as a number: 1 for a row that has none, as every schema save reads it. */
function versionOf(stored: unknown): number {
  const version = Number(stored);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

/** A CONFLICT refusing the rename, naming the fields that stand in its way. */
function refusal(
  move: EntitySlugMove,
  fields: readonly TargetingField[],
  why: string,
  reason: string
): NextlyError {
  const names = fields.map(field => field.name).sort();
  return NextlyError.conflict({
    reason: "state",
    message: `This collection can't be renamed while ${why}: ${names.join(", ")}.`,
    logContext: { reason, slug: move.from, to: move.to, fields: names },
  });
}

/**
 * Refuse what a rename cannot move, with a CONFLICT naming the fields: a polymorphic field listing
 * the collection, a field an entity's code defines that targets it, and a field already naming the
 * new slug. A precondition: run first in the rename's transaction, before the registry row is
 * written, so nothing is written for a rename that is refused.
 */
export async function refuseUnmovableTargets(
  tx: TransactionContext,
  move: EntitySlugMove,
  present: ReadonlySet<string>
): Promise<void> {
  if (move.kind !== "collection" || move.from === move.to) return;
  const fields = targetingFields(
    (await registryRows(tx, present)).flatMap(registry => registry.rows)
  );
  const naming = (slug: string) =>
    fields.filter(field => field.targets.includes(slug));
  const polymorphic = naming(move.from).filter(field => field.polymorphic);
  if (polymorphic.length > 0) {
    throw refusal(
      move,
      polymorphic,
      "a relationship that can point at several collections lists it (remove it from the field first)",
      "rename-collection-polymorphic-target"
    );
  }
  const fromCode = naming(move.from).filter(field => field.source !== "ui");
  if (fromCode.length > 0) {
    throw refusal(
      move,
      fromCode,
      "a relationship defined in code points at it (change the code first)",
      "rename-collection-code-target"
    );
  }
  const already = naming(move.to);
  if (already.length > 0) {
    throw refusal(
      move,
      already,
      `a relationship already points at "${move.to}"`,
      "rename-collection-new-slug-targeted"
    );
  }
}

/**
 * Point every stored relationship target naming `move.from` at `move.to`, on `tx`: in every
 * collection, Single and field group whose stored fields name it, at any depth. Each row changed
 * gets the schema hash of its new fields, so the stored hash keeps describing the stored fields,
 * and its schema version moved on, as every save of its fields moves it: an editor still holding
 * the schema from before the rename is then refused by the version check every schema save makes,
 * rather than saving the old target back over the new one. The rename holds the schema lock, so
 * no save reads or writes a version between this read and this write. The tables stay as they
 * were, so nothing else is due to change.
 */
export async function moveRelationshipTargets(
  tx: TransactionContext,
  move: EntitySlugMove,
  present: ReadonlySet<string>
): Promise<void> {
  if (move.kind !== "collection" || move.from === move.to) return;
  for (const { table, rows } of await registryRows(tx, present)) {
    for (const row of rows) {
      const fields = retargeted(fieldsOf(row.fields), move.from, move.to);
      if (fields === null) continue;
      await tx.update(
        table,
        {
          fields: JSON.stringify(fields),
          schema_hash: calculateSchemaHash(fields as FieldConfig[]),
          // A row never versioned reads as version 1, as the schema saves read it.
          schema_version: versionOf(row.schemaVersion) + 1,
          updated_at: new Date(),
        },
        { and: [{ column: "id", op: "=", value: row.id }] }
      );
    }
  }
}
