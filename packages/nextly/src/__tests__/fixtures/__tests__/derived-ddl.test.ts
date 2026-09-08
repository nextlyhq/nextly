/**
 * What the fixture's derived DDL must keep from the production schema.
 *
 * `ddlFor` builds each table from its Drizzle definition rather than from a
 * hand-written copy, which is what stops the two drifting. The risk it carries
 * instead is NARROWNESS: anything it does not translate is silently absent, and
 * a constraint that is absent does not fail a test — it makes one pass.
 *
 * Every case here was a real omission found in review, and each made the
 * fixture more permissive than production in a way no existing test could see.
 *
 * @module __tests__/fixtures/__tests__/derived-ddl.test
 */
import { describe, expect, it } from "vitest";

import { createTestDb } from "../db";

/** The raw better-sqlite3 handle, for PRAGMA and sqlite_master reads. */
type RawSqlite = {
  prepare(sql: string): { all(): unknown[] };
};

describe("fixture DDL derived from the Drizzle schema", () => {
  it("carries column-level UNIQUE, so a collision test can fail", async () => {
    const testDb = await createTestDb();
    const raw = testDb.adapter.getDrizzle<{ $client: RawSqlite }>().$client;

    // `email_templates` rather than `dynamic_collections`, and the swap is the
    // point: `createTables` runs the production generators FIRST and only then
    // fills the gaps with `ddlFor`, so a table the bootstrap DDL now creates
    // keeps the generator's definition and stops exercising `ddlFor` at all.
    // Asserting the derived spelling on such a table tests the generator while
    // reading as though it tests the fixture. This one the generators still do
    // not cover, and it declares `.unique()` on the column the same way.
    const ddl = (
      raw
        .prepare(
          "SELECT sql FROM sqlite_master WHERE tbl_name='email_templates'"
        )
        .all() as { sql: string }[]
    )[0].sql;

    // Declared with `.unique()` on the column rather than as a table index.
    // Without this the fixture accepted duplicates that production rejects, so
    // a test about collision handling passed while proving nothing.
    expect(ddl).toContain('"slug" text NOT NULL UNIQUE');
    await testDb.close();
  });

  it("rejects a duplicate slug whichever source built the table", async () => {
    const testDb = await createTestDb();
    const raw = testDb.adapter.getDrizzle<{
      $client: RawSqlite & { exec(sql: string): unknown };
    }>().$client;

    // The property the assertion above stands in for, asked of the DATABASE
    // rather than of its DDL text — so it holds whether `dynamic_collections`
    // came from the production generator or from `ddlFor`, and keeps holding
    // when another table moves between the two.
    //
    // Written as an insert rather than a count of unique indexes. That count
    // cannot fail for the right reason: the text primary key and `table_name`
    // supply two on their own, so it stays satisfied with the slug constraint
    // gone — which is the one thing it exists to detect.
    const row = (slug: string) =>
      `INSERT INTO "dynamic_collections" ` +
      `("id","slug","labels","table_name","fields","schema_hash","created_at","updated_at") ` +
      `VALUES ('${slug}-id','${slug}','{}','${slug}_table','[]','h',1,1)`;

    raw.exec(row("first"));
    // Same slug, different id and table_name, so only the slug can refuse it.
    expect(() =>
      raw.exec(
        `INSERT INTO "dynamic_collections" ` +
          `("id","slug","labels","table_name","fields","schema_hash","created_at","updated_at") ` +
          `VALUES ('second-id','first','{}','second_table','[]','h',1,1)`
      )
    ).toThrow(/UNIQUE/i);

    await testDb.close();
  });

  it("carries foreign keys WITH their referential actions", async () => {
    const testDb = await createTestDb();
    const raw = testDb.adapter.getDrizzle<{ $client: RawSqlite }>().$client;

    const fks = raw.prepare("PRAGMA foreign_key_list(api_keys)").all() as {
      table: string;
      from: string;
      on_delete: string;
    }[];

    // The actions are the point, not merely the constraint. Production deletes
    // an api key when its user goes and nulls its role_id when the role goes;
    // a fixture without them lets a deletion test pass while leaving exactly
    // the orphan that test was written to catch. The fixture enables
    // `foreign_keys` ON, so omitting these changed behaviour rather than
    // skipping a check.
    expect(fks).toHaveLength(2);
    expect(fks).toContainEqual(
      expect.objectContaining({
        table: "users",
        from: "user_id",
        on_delete: "CASCADE",
      })
    );
    expect(fks).toContainEqual(
      expect.objectContaining({
        table: "roles",
        from: "role_id",
        on_delete: "SET NULL",
      })
    );
    await testDb.close();
  });

  it("carries a SQL default, so the archive path can run at all", async () => {
    const testDb = await createTestDb();

    // `nextly_i18n_archive.archived_at` is NOT NULL with
    // `DEFAULT (unixepoch())`, and the localization-disable path archives rows
    // WITHOUT naming that column — it relies on the database to supply the
    // value. A literal-only default translation dropped it, so this insert hit
    // the NOT NULL constraint and the whole archive path was unreachable from
    // a test.
    await expect(
      testDb.adapter.executeQuery(
        "INSERT INTO nextly_i18n_archive (collection, entry_id, locale, field, value) " +
          "VALUES (?, ?, ?, ?, ?)",
        ["posts", "entry-1", "fr", "title", "Bonjour"]
      )
    ).resolves.toBeDefined();
    await testDb.close();
  });
});
