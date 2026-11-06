/**
 * The rules `nextly migrate` and `migrate:status` judge the registry by,
 * apart from the database reads: which fields a row records have a column on
 * its table, and which registry a declared entity's row belongs in.
 *
 * Each case is one a plausible broken comparison gets wrong: one that expects
 * a column for a field kept elsewhere reports a healthy entity, one that asks
 * the collection question of a field group's row misses a lost column, and
 * one that pools the registries lets a collection's row answer for a single.
 * The reads themselves, and both commands printing the result, are covered on
 * every dialect by `cli/commands/__tests__/migrate-registry-consistency.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  compareRegistryWithTables,
  registryDisagreementLines,
  type LiveColumns,
  type RegistryRows,
} from "../registry-consistency";
import type { RegisteredCollectionRow as Row } from "../../pipeline/registered-collections";
import type { EntityKind } from "../resolved-schema";

function rows(
  entries: Partial<Record<EntityKind, Row[] | null>>
): RegistryRows {
  return new Map<EntityKind, readonly Row[] | null>([
    ["collection", entries.collection === undefined ? [] : entries.collection],
    ["single", entries.single === undefined ? [] : entries.single],
    ["fieldGroup", entries.fieldGroup === undefined ? [] : entries.fieldGroup],
  ]);
}

function live(tables: Record<string, string[]>): LiveColumns {
  return new Map(
    Object.entries(tables).map(([table, columns]) => [table, new Set(columns)])
  );
}

function compare(args: {
  rows: RegistryRows;
  live: LiveColumns;
  declared?: { kind: EntityKind; slug: string }[];
}) {
  return compareRegistryWithTables({
    declared: [],
    dialect: "postgresql",
    ...args,
  });
}

describe("compareRegistryWithTables — columns", () => {
  it("expects no column for a field kept in another table or nowhere", () => {
    const report = compare({
      rows: rows({
        collection: [
          {
            slug: "posts",
            tableName: "dc_posts",
            locked: true,
            fields: [
              { name: "title", type: "text" },
              // A many-to-many keeps its links in a junction table.
              {
                name: "tags",
                type: "relationship",
                options: { target: "tags", relationType: "manyToMany" },
              },
              // A field group keeps its values in its own table.
              { name: "hero", type: "component", component: "hero" },
              // A virtual field stores nothing.
              { name: "preview", type: "text", virtual: true },
            ],
          },
        ],
      }),
      live: live({ dc_posts: ["id", "title"] }),
    });

    expect(report.missingColumns).toEqual([]);
  });

  it("names a recorded field whose column is gone, by its column name", () => {
    const report = compare({
      rows: rows({
        collection: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [
              { name: "title", type: "text" },
              { name: "searchVector", type: "text" },
            ],
          },
        ],
      }),
      live: live({ dc_posts: ["id", "title"] }),
    });

    expect(report.missingColumns).toEqual([
      {
        kind: "collection",
        slug: "posts",
        table: "dc_posts",
        field: "searchVector",
        column: "search_vector",
      },
    ]);
  });

  it("leaves a localized entity's translatable fields to its companion", () => {
    const report = compare({
      rows: rows({
        collection: [
          {
            slug: "pages",
            tableName: "dc_pages",
            localized: true,
            fields: [
              { name: "title", type: "text" },
              { name: "views", type: "number" },
            ],
          },
        ],
      }),
      // `title` is translatable, so it lives in `dc_pages_locales`; `views`
      // is shared and belongs on the main table.
      live: live({ dc_pages: ["id"] }),
    });

    expect(report.missingColumns.map(d => d.field)).toEqual(["views"]);
  });

  it("expects a column for a many-to-many on a field group's row", () => {
    const report = compare({
      rows: rows({
        fieldGroup: [
          {
            slug: "card",
            tableName: "comp_card",
            fields: [
              {
                name: "links",
                type: "relationship",
                options: { target: "posts", relationType: "manyToMany" },
              },
            ],
          },
        ],
      }),
      live: live({ comp_card: ["id"] }),
    });

    expect(report.missingColumns).toEqual([
      {
        kind: "fieldGroup",
        slug: "card",
        table: "comp_card",
        field: "links",
        column: "links",
      },
    ]);
  });

  it("matches a table and its columns without regard to case", () => {
    const report = compare({
      rows: rows({
        collection: [
          {
            slug: "posts",
            tableName: "DC_Posts",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      }),
      live: live({ dc_posts: ["title"] }),
    });

    expect(report.missingTables).toEqual([]);
    expect(report.missingColumns).toEqual([]);
  });
});

describe("compareRegistryWithTables — tables and rows", () => {
  it("names a row whose table is gone, and no column of it", () => {
    const report = compare({
      rows: rows({
        single: [
          {
            slug: "home",
            tableName: "single_home",
            fields: [{ name: "headline", type: "text" }],
          },
        ],
      }),
      live: live({}),
    });

    expect(report.missingTables).toEqual([
      { kind: "single", slug: "home", table: "single_home" },
    ]);
    expect(report.missingColumns).toEqual([]);
  });

  it("looks for a declared entity's row in its own registry only", () => {
    const report = compare({
      rows: rows({
        collection: [{ slug: "about", tableName: "dc_about", fields: [] }],
      }),
      live: live({ dc_about: ["id"] }),
      declared: [
        { kind: "collection", slug: "about" },
        // The same slug as a single: the collection's row is not its row.
        { kind: "single", slug: "about" },
      ],
    });

    expect(report.unregistered).toEqual([{ kind: "single", slug: "about" }]);
  });

  it("lists an unreadable registry and judges none of its kind", () => {
    const report = compare({
      rows: rows({ single: null }),
      live: live({}),
      declared: [{ kind: "single", slug: "home" }],
    });

    expect(report.unreadable).toEqual(["single"]);
    expect(report.unregistered).toEqual([]);
  });
});

describe("registryDisagreementLines", () => {
  it("says nothing for a database with no registry or nothing to name", () => {
    expect(registryDisagreementLines(null)).toEqual([]);
    expect(
      registryDisagreementLines({
        missingTables: [],
        missingColumns: [],
        unregistered: [],
        unreadable: [],
      })
    ).toEqual([]);
  });

  it("names each disagreement, with the commands after the tables and columns", () => {
    expect(
      registryDisagreementLines({
        missingTables: [{ kind: "collection", slug: "a", table: "dc_a" }],
        missingColumns: [
          {
            kind: "fieldGroup",
            slug: "b",
            table: "comp_b",
            field: "linkUrl",
            column: "link_url",
          },
        ],
        unregistered: [{ kind: "single", slug: "c" }],
        unreadable: [],
      })
    ).toEqual([
      'collection "a": its registry row names table "dc_a", which does not exist.',
      'field group "b": field "linkUrl" has no column "link_url" in table "comp_b".',
      "The database has not been migrated for the tables and columns above. Run `nextly migrate:create` for a change that has no migration yet, then `nextly migrate`.",
      'single "c" is declared in the configuration but has no registry row.',
    ]);
  });

  it("names an entity with no row without the migrate commands", () => {
    expect(
      registryDisagreementLines({
        missingTables: [],
        missingColumns: [],
        unregistered: [{ kind: "collection", slug: "c" }],
        unreadable: [],
      })
    ).toEqual([
      'collection "c" is declared in the configuration but has no registry row.',
    ]);
  });

  it("names an unreadable registry without a migrate remedy", () => {
    expect(
      registryDisagreementLines({
        missingTables: [],
        missingColumns: [],
        unregistered: [],
        unreadable: ["fieldGroup"],
      })
    ).toEqual([
      "Could not read the field group registry, so its rows were not compared with the tables.",
    ]);
  });
});
