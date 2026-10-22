/**
 * Every slug-holding column of the core schema is declared in `SLUG_COLUMNS`,
 * so a rename cannot leave a table's rows behind because nobody remembered it.
 *
 * The columns are read out of the core schema itself, on every dialect, rather
 * than listed here: a list in this file would agree with the declarations on
 * the day it was written and miss the next table exactly as the rename would.
 * A column holds a slug when its name has a `slug` or `collection` part; both
 * spellings occur (`scope_slug`, `activity_log.collection`).
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { getCoreSchema } from "../../../schemas";
import { SLUG_COLUMNS, renamedSlugColumns } from "../slug-columns";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** Whether a column's name says it holds a slug. */
function holdsSlug(column: string): boolean {
  const parts = column.split("_");
  return parts.includes("slug") || parts.includes("collection");
}

/** `table.column` for every slug-holding column the core schema declares. */
function slugColumnsInSchema(dialect: SupportedDialect): string[] {
  return getCoreSchema(dialect)
    .tables.flatMap(table =>
      table.columns
        .filter(column => holdsSlug(column.name))
        .map(column => `${table.name}.${column.name}`)
    )
    .sort();
}

/** The columns of each core table, by table name. */
function columnsByTable(dialect: SupportedDialect): Map<string, Set<string>> {
  return new Map(
    getCoreSchema(dialect).tables.map(table => [
      table.name,
      new Set(table.columns.map(column => column.name)),
    ])
  );
}

describe.each(DIALECTS)("slug-keyed core tables (%s)", dialect => {
  it("finds the history tables, so an empty scan cannot pass", () => {
    // The population first: a scan that read nothing would declare every
    // column covered.
    expect(slugColumnsInSchema(dialect)).toEqual(
      expect.arrayContaining([
        "nextly_versions.scope_slug",
        "nextly_content_events.subject_slug",
        "nextly_release_members.scope_slug",
      ])
    );
  });

  it("declares every slug-holding column", () => {
    const declared = new Set(
      SLUG_COLUMNS.map(column => `${column.table}.${column.slugColumn}`)
    );
    const undeclared = slugColumnsInSchema(dialect).filter(
      column => !declared.has(column)
    );
    expect(undeclared).toEqual([]);
  });

  it("declares only columns the core schema has", () => {
    const tables = columnsByTable(dialect);
    const missing = SLUG_COLUMNS.flatMap(column => {
      const named = [
        column.slugColumn,
        ...(column.onRename === "keep"
          ? []
          : [
              column.kindColumn,
              ...(column.onRename === "follow" && column.key
                ? [column.key.column, column.key.rowId, ...column.key.sources]
                : []),
            ]),
      ];
      const have = tables.get(column.table);
      return named
        .filter(name => !have?.has(name))
        .map(name => `${column.table}.${name}`);
    });
    expect(missing).toEqual([]);
  });

  it("names each kind a rename moves on every column it acts on", () => {
    for (const column of renamedSlugColumns()) {
      expect(column.kinds.collection.length).toBeGreaterThan(0);
      expect(column.kinds.single.length).toBeGreaterThan(0);
    }
  });
});
