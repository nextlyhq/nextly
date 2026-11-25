/**
 * A schema hook finds a collection by the table the pipeline creates for it.
 *
 * The compiler seeds every entity table so `extendTable` and `index` can look
 * one up. A collection's table is `resolveCollectionTableName(slug, dbName)`:
 * its `dbName` when it has one, and its slug with dashes turned to underscores
 * otherwise. A seed spelled `dc_<slug>` names neither, so a hook targeting the
 * real table was refused as "does not exist" at boot, in migration generation
 * and in dev sync.
 */
import { describe, expect, it } from "vitest";

import { col } from "../dsl";
import { compileExtensionSchema } from "../publish";

const logger = { warn: () => {}, debug: () => {} };

function extending(table: string) {
  return ({
    schema,
  }: {
    schema: { extendTable(name: string, input: unknown): void };
  }) => {
    schema.extendTable(table, {
      columns: { searchVector: col.text({ nullable: true }) },
    });
  };
}

async function compileWith(collection: Record<string, unknown>, table: string) {
  return compileExtensionSchema({
    dialect: "postgresql",
    plugins: [],
    config: {
      collections: [{ fields: [], ...collection }],
      db: { schema: { extend: [extending(table)] } },
    },
    logger,
  } as never);
}

describe("a schema hook extending a collection's table", () => {
  it("finds a collection by its dbName table", async () => {
    const schema = await compileWith(
      { slug: "posts", dbName: "legacy_posts" },
      "dc_legacy_posts"
    );

    expect(
      schema?.entityColumns.get("dc_legacy_posts")?.map(c => c.name)
    ).toEqual(["search_vector"]);
  });

  it("finds a dashed slug by its underscored table", async () => {
    const schema = await compileWith({ slug: "blog-posts" }, "dc_blog_posts");

    expect(
      schema?.entityColumns.get("dc_blog_posts")?.map(c => c.name)
    ).toEqual(["search_vector"]);
  });
});

describe("a collection with a group that has no name", () => {
  it("compiles, with the fields the group lays out as columns of the table", async () => {
    // Such a group keeps its fields on the collection's own row and has no column of its own.
    const schema = await compileExtensionSchema({
      dialect: "postgresql",
      plugins: [],
      config: {
        collections: [
          {
            slug: "posts",
            fields: [
              {
                type: "group",
                fields: [{ name: "rank", type: "number", localized: false }],
              },
            ],
          },
        ],
        db: {
          schema: {
            extend: [
              ({
                schema,
              }: {
                schema: { extendTable(name: string, input: unknown): void };
              }) => {
                schema.extendTable("dc_posts", {
                  indexes: [{ columns: ["rank"] }],
                });
              },
            ],
          },
        },
      },
      logger,
    } as never);

    expect(
      schema?.entityIndexes.get("dc_posts")?.map(index => index.columns)
    ).toEqual([["rank"]]);
  });
});
