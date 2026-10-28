/**
 * The many-to-many relationships between collections, as their stored field
 * configurations declare them.
 *
 * A many-to-many field keeps its links in a junction table whose name and
 * columns are spelled from both collections' slugs, and a rename keeps every
 * physical name. A rename therefore asks this which relationships use the
 * collection it would rename, on either side, and refuses when there are any.
 *
 * @module domains/entity-rename/many-to-many-links
 */

import { usesJunctionTable } from "../schema/services/field-column-descriptor";

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

/** A stored `fields` value, from either form a driver returns. */
function fieldsOf(value: unknown): unknown[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
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
 * Every many-to-many field the rows declare that has a junction table: a
 * top-level field `usesJunctionTable` answers yes to, with an `options.target`.
 * It is the same rule the collection's DDL applies when it creates the junction,
 * so this lists exactly the relationships that have one. A many-to-many nested
 * in a group or repeater has no junction: its ids are kept in that container's
 * JSON.
 */
export function manyToManyLinks(
  rows: readonly StoredCollectionFields[]
): ManyToManyLink[] {
  const links: ManyToManyLink[] = [];
  for (const row of rows) {
    if (typeof row.slug !== "string") continue;
    for (const field of fieldsOf(row.fields)) {
      if (typeof field !== "object" || field === null) continue;
      if (!usesJunctionTable(field)) continue;
      const target = textAt(
        "options" in field ? field.options : undefined,
        "target"
      );
      const name = textAt(field, "name");
      if (target === undefined || name === undefined) continue;
      links.push({ collection: row.slug, field: name, target });
    }
  }
  return links;
}
