// What the files `migrate:create` is about to write delete, judged by the statement judge
// `nextly migrate` uses, against the schema the latest snapshot records, and worded from the plan
// where the plan knows why.
import { describe, expect, it } from "vitest";

import {
  buildDesiredSnapshotFromConfigForTest,
  type MinimalConfigEntity,
} from "../generate";
import { judgedDeletions, type DeletionPlan } from "../planned-deletions";

const POSTS: MinimalConfigEntity = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [
    { name: "title", type: "text" },
    { name: "summary", type: "text" },
    { name: "price", type: "text" },
  ],
};
const TAGS: MinimalConfigEntity = {
  slug: "posts_tags",
  tableName: "dc_posts_tags",
  fields: [{ name: "label", type: "text" }],
};
const previous = buildDesiredSnapshotFromConfigForTest(
  [POSTS, TAGS],
  [],
  [],
  "postgresql"
);

const judge = (files: string[][], plan: Partial<DeletionPlan> = {}, main = 0) =>
  judgedDeletions({
    files,
    main,
    dialect: "postgresql",
    previous,
    plan: { operations: [], ...plan },
  });

describe("judgedDeletions", () => {
  it("names a removed entity's own table, and leaves any other table it drops unexplained", () => {
    const { all } = judge(
      [['DROP TABLE "dc_posts"', 'DROP TABLE "dc_posts_tags"']],
      {
        removedEntities: [
          { kind: "collection", slug: "posts", table: "dc_posts" },
        ],
      }
    );
    expect(all).toEqual([
      {
        kind: "table",
        table: "dc_posts",
        reason: "collection posts is no longer in the config",
      },
      { kind: "table", table: "dc_posts_tags" },
    ]);
  });

  it("names a dropped column as the rename declined, where it was one", () => {
    const { all } = judge(
      [
        [
          'ALTER TABLE "dc_posts" DROP COLUMN "summary"',
          'ALTER TABLE "dc_posts" DROP COLUMN "title"',
        ],
      ],
      {
        declinedRenames: [
          { tableName: "dc_posts", fromColumn: "summary", toColumn: "excerpt" },
          { tableName: "dc_posts", fromColumn: "summary", toColumn: "teaser" },
        ],
      }
    );
    expect(all).toEqual([
      {
        kind: "column",
        table: "dc_posts",
        column: "summary",
        reason: "rename to excerpt or teaser declined",
      },
      { kind: "column", table: "dc_posts", column: "title" },
    ]);
  });

  it("judges a type change as nextly migrate does, and names the change", () => {
    const { all } = judge(
      [
        [
          'ALTER TABLE "dc_posts" ALTER COLUMN "price" SET DATA TYPE integer USING "price"::integer',
        ],
      ],
      {
        operations: [
          {
            type: "change_column_type",
            tableName: "dc_posts",
            columnName: "price",
            fromType: "text",
            toType: "integer",
          },
        ],
      }
    );
    expect(all).toEqual([
      {
        kind: "column",
        table: "dc_posts",
        column: "price",
        reason: "type changes from text to integer",
      },
    ]);
  });

  it("names the rows a person's answer removes", () => {
    const { all } = judge([['DELETE FROM "dc_posts" WHERE "title" IS NULL']], {
      resolutions: [
        {
          tableName: "dc_posts",
          columnName: "title",
          kind: "delete_nonconforming",
        },
      ],
    });
    expect(all).toEqual([
      {
        kind: "rows",
        table: "dc_posts",
        reason: "rows with no title removed, so the column can be required",
      },
    ]);
  });

  it("finds nothing in statements that keep every value", () => {
    const { all } = judge([
      [
        'ALTER TABLE "dc_posts" RENAME COLUMN "summary" TO "excerpt"',
        'ALTER TABLE "dc_posts" ADD COLUMN "subtitle" text',
        'UPDATE "dc_posts" SET "title" = \'x\' WHERE "title" IS NULL',
      ],
    ]);
    expect(all).toEqual([]);
  });

  it("gives the main file its own deletions, and the run every file's, each once", () => {
    const { main, all } = judge(
      [
        ['ALTER TABLE "dc_posts" DROP COLUMN "summary"'],
        ['DROP TABLE "dc_posts_tags"'],
        ['ALTER TABLE "dc_posts" DROP COLUMN "price"'],
      ],
      {},
      1
    );
    expect(main).toEqual([{ kind: "table", table: "dc_posts_tags" }]);
    expect(
      all.map(d =>
        "column" in d
          ? `${d.table}.${d.column}`
          : d.kind === "unnamed"
            ? d.description
            : d.table
      )
    ).toEqual(["dc_posts.summary", "dc_posts_tags", "dc_posts.price"]);
  });

  it("judges a later file against what an earlier one left: a table it created holds nothing", () => {
    const { all } = judge([
      ['CREATE TABLE "dc_scratch" ("id" text PRIMARY KEY)'],
      ['DROP TABLE "dc_scratch"'],
    ]);
    expect(all).toEqual([]);
  });
});
