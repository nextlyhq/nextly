// Which removed tables migrate:create judges as whose: a collection's and a Single's by their
// prefix, a field group's by its prefix or, for one named through the `dbName` it once accepted,
// by the parent columns every field-group table carries. And a removed field group under such a
// table refused while something still depends on it.
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { ColumnSpec, TableSpec } from "../../pipeline/diff/types";
import { removedEntityTables, type MinimalConfigEntity } from "../generate";
import { assertRemovedEntitiesUnused } from "../removed-collections";

const column = (name: string): ColumnSpec => ({
  name,
  type: "text",
  nullable: true,
});
const table = (name: string, columns: string[]): TableSpec => ({
  name,
  columns: ["id", ...columns].map(column),
});
const PARENT = ["_parent_id", "_parent_table", "_parent_field", "_order"];

function removed(...tables: TableSpec[]) {
  return removedEntityTables({
    previous: { tables },
    collections: [],
    singles: [],
    components: [],
    dialect: "sqlite",
  });
}

describe("removedEntityTables", () => {
  it("reads a field group named through its old dbName as one, by its parent columns", () => {
    expect(removed(table("my_seo_block", ["heading", ...PARENT]))).toEqual({
      collections: [],
      singles: [],
      fieldGroups: ["my_seo_block"],
    });
  });

  it("reads no field group in a table without a prefix or the parent columns", () => {
    expect(removed(table("my_archive", ["heading"]))).toEqual({
      collections: [],
      singles: [],
      fieldGroups: [],
    });
  });

  it("reads each prefixed table as its prefix names it", () => {
    expect(
      removed(
        table("dc_posts", ["title"]),
        table("single_home", ["title"]),
        table("comp_seo", ["heading", ...PARENT])
      )
    ).toEqual({
      collections: ["dc_posts"],
      singles: ["single_home"],
      fieldGroups: ["comp_seo"],
    });
  });
});

describe("a removed field group named through its old dbName", () => {
  const articles: MinimalConfigEntity = {
    slug: "articles",
    tableName: "dc_articles",
    fields: [{ name: "seo", type: "component", component: "seo" }] as never,
  };

  async function refusal(input: {
    collections: MinimalConfigEntity[];
    linksTo?: string;
  }): Promise<NextlyError> {
    const outcome = await assertRemovedEntitiesUnused({
      removed: { collections: [], singles: [], fieldGroups: ["my_seo_block"] },
      collections: input.collections,
      singles: [],
      components: [],
      dialect: "sqlite",
      extensionSchema: () =>
        Promise.resolve(
          input.linksTo === undefined
            ? null
            : ({
                specs: [
                  {
                    name: "plg__links",
                    columns: [],
                    foreignKeys: [
                      {
                        name: "fk_links_block",
                        columns: ["block_id"],
                        referencesTable: input.linksTo,
                        referencesColumns: ["id"],
                        onDelete: "no action",
                        onUpdate: "no action",
                      },
                    ],
                  },
                ],
                owners: new Map([
                  ["plg__links", { kind: "plugin", id: "plg" }],
                ]),
                entityColumns: new Map(),
                entityIndexes: new Map(),
                elementOwners: new Map(),
              } as never)
        ),
    }).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(NextlyError.is(outcome)).toBe(true);
    return outcome as NextlyError;
  }

  it("is refused while a remaining field places it, naming the field", async () => {
    const error = await refusal({ collections: [articles] });

    expect(error.publicMessage).toContain(`"seo" cannot be deleted`);
    expect(error.publicMessage).toContain("articles.seo");
  });

  it("is refused while a plugin's key points at its table, naming the plugin and the table", async () => {
    const error = await refusal({ collections: [], linksTo: "my_seo_block" });

    expect(error.publicMessage).toContain(`"my_seo_block" cannot be deleted`);
    expect(error.publicMessage).toContain(`plugin "plg"`);
  });
});
