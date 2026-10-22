/**
 * Every slug-holding column of the core schema is declared in `SLUG_COLUMNS`,
 * so a rename cannot leave a table's rows behind because nobody remembered it.
 *
 * The columns are read out of the core schema itself, on every dialect, rather
 * than listed here: a list in this file would agree with the declarations on
 * the day it was written and miss the next table exactly as the rename would.
 * A column holds a slug when its name has a `slug`, `collection` or `resource`
 * part; all three spellings occur (`scope_slug`, `activity_log.collection`,
 * `permissions.resource`).
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { getCoreSchema } from "../../../schemas";
import { entityPermissionSpelling } from "../../auth/services/entity-permission-spelling";
import {
  SLUG_COLUMNS,
  renamedSlugColumns,
  type FollowingSlugColumn,
  type RenamedSlugColumn,
  type SlugColumn,
} from "../slug-columns";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** Whether a column's name says it holds a slug. */
function holdsSlug(column: string): boolean {
  const parts = column.split("_");
  return (
    parts.includes("slug") ||
    parts.includes("collection") ||
    parts.includes("resource")
  );
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

/**
 * `table.column` for every column a declaration accounts for: the slug column
 * itself, and the columns a moved row has derived again from the new slug
 * (a permission's `slug` beside its `resource`).
 */
function declaredColumns(): Set<string> {
  return new Set(
    SLUG_COLUMNS.flatMap(column =>
      column.onRename === "follow-json"
        ? [`${column.table}.${column.jsonColumn}`]
        : [
            `${column.table}.${column.slugColumn}`,
            ...(column.onRename === "follow" && column.derived
              ? column.derived.columns.map(name => `${column.table}.${name}`)
              : []),
          ]
    )
  );
}

/** The columns a moved row's derived values are read from and written to. */
function derivedNames(column: FollowingSlugColumn): string[] {
  const derived = column.derived;
  if (derived === undefined) return [];
  const present = derived.onlyWhereSet ? [derived.onlyWhereSet] : [];
  return [derived.rowId, ...derived.columns, ...derived.sources, ...present];
}

/** The columns that say which rows of a table are one entity's. */
function scopeNames(column: RenamedSlugColumn): string[] {
  const kind = column.kind ? [column.kind.column] : [];
  return [column.slugColumn, ...kind, ...(column.onlyWhereNull ?? [])];
}

/** Every column a declaration names, for checking that the table has it. */
function namedBy(column: SlugColumn): string[] {
  if (column.onRename === "keep") return [column.slugColumn];
  if (column.onRename === "follow-json") {
    return [column.jsonColumn, column.rowId, ...(column.onlyWhereNull ?? [])];
  }
  if (column.onRename === "end") return scopeNames(column);
  return [...scopeNames(column), ...derivedNames(column)];
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
        "permissions.resource",
      ])
    );
  });

  it("declares every slug-holding column", () => {
    const undeclared = slugColumnsInSchema(dialect).filter(
      column => !declaredColumns().has(column)
    );
    expect(undeclared).toEqual([]);
  });

  it("declares only columns the core schema has", () => {
    const tables = columnsByTable(dialect);
    const missing = SLUG_COLUMNS.flatMap(column => {
      const have = tables.get(column.table);
      return namedBy(column)
        .filter(name => !have?.has(name))
        .map(name => `${column.table}.${name}`);
    });
    expect(missing).toEqual([]);
  });

  it("names each kind a rename moves on every column that records a kind", () => {
    for (const column of renamedSlugColumns()) {
      if (column.kind === undefined) continue;
      expect(column.kind.values.collection.length).toBeGreaterThan(0);
      expect(column.kind.values.single.length).toBeGreaterThan(0);
    }
  });
});

/** The declaration of `table`'s rows that follow a rename. */
function following(table: string): FollowingSlugColumn {
  const found = SLUG_COLUMNS.find(
    (column): column is FollowingSlugColumn =>
      column.table === table && column.onRename === "follow"
  );
  if (found?.derived === undefined) throw new Error(`no derived ${table}`);
  return found;
}

describe("what a rename writes again from the new slug", () => {
  it("respells only the permission values the framework spelled for the old slug", () => {
    const derive = following("permissions").derived?.derive;
    const old = entityPermissionSpelling("read", "notes");
    expect(derive?.({ action: "read", ...old }, "journal", "notes")).toEqual(
      entityPermissionSpelling("read", "journal")
    );
    // An application's own slug and an administrator's name are kept: they
    // are left out of what is written.
    expect(
      derive?.(
        {
          action: "approve",
          slug: "approve-editorial",
          name: "Approve Editorial",
          description: null,
        },
        "journal",
        "notes"
      )
    ).toEqual({});
    expect(
      derive?.(
        { action: "read", ...old, name: "Read the notebook" },
        "journal",
        "notes"
      )
    ).toEqual({
      slug: "read-journal",
      description: entityPermissionSpelling("read", "journal").description,
    });
  });

  it("renames the resource a waiting event's envelope names, in either stored form", () => {
    const derive = following("nextly_events").derived?.derive;
    const entry = {
      id: "e1",
      resource: { kind: "entry", collection: "notes", id: "1" },
    };
    const single = { id: "e2", resource: { kind: "single", slug: "notes" } };
    const renamed = (payload: unknown) =>
      derive?.({ payload }, "journal", "notes").payload;
    expect(renamed(entry)).toEqual({
      ...entry,
      resource: { ...entry.resource, collection: "journal" },
    });
    expect(renamed(JSON.stringify(single))).toEqual({
      ...single,
      resource: { ...single.resource, slug: "journal" },
    });
    // An envelope about something else, or one that does not parse, is
    // written back as it was.
    const other = { resource: { kind: "entry", collection: "posts" } };
    expect(renamed(other)).toBe(other);
    expect(renamed("{not json")).toBe("{not json");
  });
});
