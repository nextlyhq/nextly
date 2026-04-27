import { describe, expect, it } from "vitest";

import { filterSqliteRecreateBlocks } from "../rename-detector-sqlite-recreate.js";

describe("filterSqliteRecreateBlocks", () => {
  it("filters a complete 4-statement recreate block", () => {
    const stmts = [
      `CREATE TABLE "__new_dc_posts" ("id" integer, "title" text);`,
      `INSERT INTO "__new_dc_posts" ("id", "title") SELECT "id", "title" FROM "dc_posts";`,
      `DROP TABLE "dc_posts";`,
      `ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts";`,
    ];
    expect(filterSqliteRecreateBlocks(stmts)).toEqual([]);
  });

  it("keeps a partial 3-of-4 sequence intact (no filter)", () => {
    const stmts = [
      `CREATE TABLE "__new_dc_posts" ("id" integer);`,
      `INSERT INTO "__new_dc_posts" ("id") SELECT "id" FROM "dc_posts";`,
      `DROP TABLE "dc_posts";`,
    ];
    expect(filterSqliteRecreateBlocks(stmts)).toEqual(stmts);
  });

  it("filters two consecutive recreate blocks", () => {
    const stmts = [
      `CREATE TABLE "__new_dc_posts" ("id" integer);`,
      `INSERT INTO "__new_dc_posts" ("id") SELECT "id" FROM "dc_posts";`,
      `DROP TABLE "dc_posts";`,
      `ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts";`,
      `CREATE TABLE "__new_dc_users" ("id" integer);`,
      `INSERT INTO "__new_dc_users" ("id") SELECT "id" FROM "dc_users";`,
      `DROP TABLE "dc_users";`,
      `ALTER TABLE "__new_dc_users" RENAME TO "dc_users";`,
    ];
    expect(filterSqliteRecreateBlocks(stmts)).toEqual([]);
  });

  it("preserves unrelated ALTER TABLE statements after a recreate block", () => {
    const stmts = [
      `CREATE TABLE "__new_dc_posts" ("id" integer);`,
      `INSERT INTO "__new_dc_posts" ("id") SELECT "id" FROM "dc_posts";`,
      `DROP TABLE "dc_posts";`,
      `ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts";`,
      `ALTER TABLE "dc_users" ADD COLUMN "email" text;`,
    ];
    expect(filterSqliteRecreateBlocks(stmts)).toEqual([
      `ALTER TABLE "dc_users" ADD COLUMN "email" text;`,
    ]);
  });

  it("preserves DROP+ADD on a different table from a recreate block", () => {
    const stmts = [
      `CREATE TABLE "__new_dc_posts" ("id" integer);`,
      `INSERT INTO "__new_dc_posts" ("id") SELECT "id" FROM "dc_posts";`,
      `DROP TABLE "dc_posts";`,
      `ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts";`,
      `ALTER TABLE "dc_users" DROP COLUMN "old_name";`,
      `ALTER TABLE "dc_users" ADD COLUMN "new_name" text;`,
    ];
    expect(filterSqliteRecreateBlocks(stmts)).toEqual([
      `ALTER TABLE "dc_users" DROP COLUMN "old_name";`,
      `ALTER TABLE "dc_users" ADD COLUMN "new_name" text;`,
    ]);
  });

  it("does not depend on literal '__new' suffix (structural detection)", () => {
    const stmts = [
      `CREATE TABLE "tmp_dc_posts_xyz" ("id" integer);`,
      `INSERT INTO "tmp_dc_posts_xyz" ("id") SELECT "id" FROM "dc_posts";`,
      `DROP TABLE "dc_posts";`,
      `ALTER TABLE "tmp_dc_posts_xyz" RENAME TO "dc_posts";`,
    ];
    expect(filterSqliteRecreateBlocks(stmts)).toEqual([]);
  });

  it("returns input unchanged when no recreate block is present", () => {
    const stmts = [
      `ALTER TABLE "dc_posts" DROP COLUMN "title";`,
      `ALTER TABLE "dc_posts" ADD COLUMN "name" text;`,
    ];
    expect(filterSqliteRecreateBlocks(stmts)).toEqual(stmts);
  });

  it("returns empty input unchanged", () => {
    expect(filterSqliteRecreateBlocks([])).toEqual([]);
  });
});
