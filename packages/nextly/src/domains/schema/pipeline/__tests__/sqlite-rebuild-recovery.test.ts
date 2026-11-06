/**
 * A SQLite table rebuild left part-way is finished or undone, and only a table that IS such a
 * rebuild's copy is touched.
 *
 * The copy's name alone proves nothing: a project or a plugin can own a table named
 * `__new_<table>`. So a copy is recovered only when its columns are the ones the managed table
 * is meant to have, which is what a rebuild of it creates; anything else is left as it is.
 */
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { recoverInterruptedSqliteRebuilds } from "../sqlite-rebuild-recovery";

let db: ReturnType<typeof drizzle>;

const tables = () =>
  (
    db.all(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    ) as Array<{ name: string }>
  ).map(row => row.name);

/** The managed table `dc_items` is meant to have `id` and `title`. */
const EXPECTED = new Map([["dc_items", new Set(["id", "title"])]]);

beforeEach(() => {
  db = drizzle({ client: new Database(":memory:") });
});

describe("a rebuild's copy beside its table", () => {
  it("is dropped, the table keeping every row", async () => {
    db.run(sql`CREATE TABLE dc_items (id text PRIMARY KEY, title text)`);
    db.run(sql`INSERT INTO dc_items VALUES ('1', 'kept')`);
    db.run(sql`CREATE TABLE __new_dc_items (id text PRIMARY KEY, title text)`);

    const done = await recoverInterruptedSqliteRebuilds(db, EXPECTED);

    expect(tables()).toEqual(["dc_items"]);
    expect(done).toHaveLength(1);
  });

  it("is left alone when its columns are not the table's, as another owner's table is", async () => {
    db.run(sql`CREATE TABLE dc_items (id text PRIMARY KEY, title text)`);
    db.run(
      sql`CREATE TABLE __new_dc_items (id text PRIMARY KEY, payload text)`
    );
    db.run(sql`INSERT INTO __new_dc_items VALUES ('1', 'theirs')`);

    const done = await recoverInterruptedSqliteRebuilds(db, EXPECTED);

    expect(tables()).toEqual(["__new_dc_items", "dc_items"]);
    expect(done).toEqual([]);
  });
});

describe("a rebuild's copy where its table is gone", () => {
  it("takes the table's name", async () => {
    db.run(sql`CREATE TABLE __new_dc_items (id text PRIMARY KEY, title text)`);

    await recoverInterruptedSqliteRebuilds(db, EXPECTED);

    expect(tables()).toEqual(["dc_items"]);
  });

  it("refuses, leaving it as it is, when its columns are not the table's", async () => {
    // Its rows may be the table's, under another shape. Going on would have the push create the
    // table empty beside them, so the apply stops here and says which table to look at.
    db.run(sql`CREATE TABLE __new_dc_items (id text PRIMARY KEY, other text)`);

    await expect(
      recoverInterruptedSqliteRebuilds(db, EXPECTED)
    ).rejects.toMatchObject({
      publicMessage: expect.stringContaining("__new_dc_items"),
    });
    expect(tables()).toEqual(["__new_dc_items"]);
  });
});

it("leaves a copy of a table it was not told the shape of", async () => {
  db.run(sql`CREATE TABLE dc_other (id text PRIMARY KEY)`);
  db.run(sql`CREATE TABLE __new_dc_other (id text PRIMARY KEY)`);

  await recoverInterruptedSqliteRebuilds(db, EXPECTED);

  expect(tables()).toEqual(["__new_dc_other", "dc_other"]);
});
