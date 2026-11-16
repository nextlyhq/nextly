/**
 * The many-to-many relationships between collections, as their stored field
 * configurations declare them.
 *
 * A many-to-many field keeps its links in a junction table whose name and
 * columns are spelled from both sides' slugs, and a rename keeps every
 * physical name. A rename therefore asks this which relationships use the
 * collection it would rename, on either side, and refuses when there are any.
 * A Builder collection, Single or field group can declare one, so every
 * registry of stored field configurations is asked.
 *
 * @module domains/entity-rename/many-to-many-links
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";
import { usesJunctionTable } from "../schema/services/field-column-descriptor";

import type { EntitySlugMove } from "./move-entity-slug";
import { storedFieldConfigurationTables } from "./slug-columns";

/** One many-to-many field: the collection declaring it, its name, its target. */
export interface ManyToManyLink {
  collection: string;
  field: string;
  target: string;
}

/** A registry row as the rename reads it: a slug and its stored fields. */
export interface StoredCollectionFields {
  slug: unknown;
  fields: unknown;
}

/**
 * A stored `fields` value, from either form a driver returns. Text that is not
 * JSON throws, as it does where the registries read it: read as no fields, it
 * would let through a rename that a relationship in it forbids. Shared with the
 * rename's other reader of stored fields (`relationship-targets`).
 */
export function fieldsOf(value: unknown): unknown[] {
  const parsed: unknown =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? parsed : [];
}

/** A non-empty string property of a field, or undefined. */
function textAt(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  const found: unknown = (value as Record<string, unknown>)[key];
  return typeof found === "string" && found.length > 0 ? found : undefined;
}

/**
 * The link one top-level stored field declares, when it is a many-to-many
 * field with a junction table: `usesJunctionTable` answers yes to it and it
 * names an `options.target`. Undefined for any other field.
 */
function linkOf(
  collection: string,
  field: unknown
): ManyToManyLink | undefined {
  if (typeof field !== "object" || field === null) return undefined;
  if (!usesJunctionTable(field)) return undefined;
  const target = textAt(
    "options" in field ? field.options : undefined,
    "target"
  );
  const name = textAt(field, "name");
  if (target === undefined || name === undefined) return undefined;
  return { collection, field: name, target };
}

/**
 * Every many-to-many field the rows declare that has a junction table. It is
 * the same rule the collection's DDL applies when it creates the junction
 * (`linkOf`), so this lists exactly the relationships that have one. A
 * many-to-many nested in a group or repeater has no junction: its ids are kept
 * in that container's JSON.
 */
export function manyToManyLinks(
  rows: readonly StoredCollectionFields[]
): ManyToManyLink[] {
  return rows.flatMap(row => {
    const collection = row.slug;
    if (typeof collection !== "string") return [];
    return fieldsOf(row.fields).flatMap(
      field => linkOf(collection, field) ?? []
    );
  });
}

/**
 * The many-to-many fields that use the collection `slug`: those pointing at it, in any registry
 * `present` holds (a collection's, a Single's or a field group's), and the collection's own.
 * Only the collection registry's rows are collections, so only there does a declaring slug name
 * it: a Single or field group with the same slug is another entity.
 */
async function linksUsing(
  tx: TransactionContext,
  slug: string,
  present: ReadonlySet<string>
): Promise<ManyToManyLink[]> {
  const found: ManyToManyLink[] = [];
  for (const table of storedFieldConfigurationTables()) {
    // Checked first: on PostgreSQL a read of a table that is not there aborts the transaction.
    if (!present.has(table)) continue;
    const rows = await tx.select<StoredCollectionFields>(table, {
      columns: ["slug", "fields"],
    });
    const declaresIt = table === "dynamic_collections";
    found.push(
      ...manyToManyLinks(rows).filter(
        link => link.target === slug || (declaresIt && link.collection === slug)
      )
    );
  }
  return found;
}

/**
 * Refuse to rename a collection that a many-to-many relationship uses, as the
 * collection declaring the field or as its target, with a CONFLICT naming the
 * fields, so the links stay readable and the caller knows what to change.
 *
 * A precondition: the rename runs it first in its transaction, before the
 * registry row is written, so the rows still hold the old slug and nothing is
 * written for a rename that is refused.
 */
export async function refuseManyToManyLinks(
  tx: TransactionContext,
  move: EntitySlugMove,
  present: ReadonlySet<string>
): Promise<void> {
  if (move.kind !== "collection" || move.from === move.to) return;
  const named = (await linksUsing(tx, move.from, present))
    .map(link => `${link.collection}.${link.field}`)
    .sort();
  if (named.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message: `This collection can't be renamed while a many-to-many relationship uses it: ${named.join(", ")}. Remove those fields, or keep the collection's name.`,
    logContext: {
      reason: "rename-collection-has-many-to-many",
      slug: move.from,
      fields: named,
    },
  });
}
