/**
 * On MySQL a migration that runs in a transaction can fail with rows already lasting: an implicit
 * commit keeps what ran before it, whatever the runner's transaction did. A failure after one is
 * reported partly applied, so nobody runs the file again over rows it already changed; a failure
 * that kept nothing is not, so nobody marks a file applied whose rows never changed.
 *
 * Each case asks the database which happened, and then what the failure says: both must agree.
 *
 * Self-skips when TEST_MYSQL_URL is unset.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { createAdapter } from "../../../../database/factory";
import { NextlyError } from "../../../../errors/nextly-error";
import { mysqlLiveStatements } from "../../pipeline/sql-templates/mysql-live-restate";
import { runMigrationStatements } from "../migration-transaction";

const describeMysql = describe.skipIf(!process.env.TEST_MYSQL_URL);

const FAILS = "INSERT INTO no_such_table (id) VALUES (1)";
const ALTERS = "ALTER TABLE notes ADD COLUMN added int";

/** The four statements Nextly writes to rename `body`: a schema change, run as a prepared one. */
const RENAMES = mysqlLiveStatements({
  type: "rename_column",
  tableName: "notes",
  fromColumn: "body",
  toColumn: "text",
} as Parameters<typeof mysqlLiveStatements>[0])!;

describeMysql("a transactional migration that fails on MySQL", () => {
  let adapter: DrizzleAdapter;
  let drop: () => Promise<void>;

  beforeEach(async () => {
    const scratch = await createScratchDatabase("mysql", "nextly_durable");
    drop = scratch.drop;
    adapter = (await createAdapter({
      type: "mysql",
      url: scratch.url,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    await adapter.executeQuery(
      "CREATE TABLE notes (id int PRIMARY KEY, body varchar(64))"
    );
    await adapter.executeQuery(
      "INSERT INTO notes (id, body) VALUES (1, 'one'), (2, 'two')"
    );
  }, 60_000);

  afterEach(async () => {
    await adapter.disconnect();
    await drop().catch(() => undefined);
  }, 60_000);

  /** The rows the table holds and whether the failure says part of the file stayed applied. */
  async function ran(
    statements: readonly string[]
  ): Promise<{ rows: number; partly: boolean; code: string }> {
    const error = await runMigrationStatements(adapter, statements, {
      source: "20261124_000000_000_notes.sql",
      transaction: true,
    }).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(error, "the file fails").toBeDefined();
    const [{ n }] = (await adapter.executeQuery(
      "SELECT COUNT(*) AS n FROM notes"
    )) as unknown as [{ n: unknown }];
    const code = NextlyError.is(error) ? error.code : String(error);
    return {
      rows: Number(n),
      partly: code === "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
      code,
    };
  }

  it.each([
    ["a DELETE, then a schema statement", ["DELETE FROM notes", ALTERS, FAILS]],
    [
      "a prepared DELETE, then a schema statement",
      [
        "PREPARE gone FROM 'DELETE FROM notes'",
        "EXECUTE gone",
        "DEALLOCATE PREPARE gone",
        ALTERS,
        FAILS,
      ],
    ],
    [
      "a DELETE behind a WITH, then a schema statement",
      [
        "WITH gone AS (SELECT id FROM notes) DELETE FROM notes WHERE id IN (SELECT id FROM gone)",
        ALTERS,
        FAILS,
      ],
    ],
    [
      "a TRUNCATE, which commits and empties the table",
      ["TRUNCATE TABLE notes", FAILS],
    ],
    [
      "a DELETE, then a view, whose CREATE commits",
      [
        "DELETE FROM notes",
        "CREATE VIEW notes_view AS SELECT id FROM notes",
        FAILS,
      ],
    ],
    [
      "a DELETE, then an ALTER of a table that is not there",
      ["DELETE FROM notes", "ALTER TABLE no_such_table ADD COLUMN c int"],
    ],
    [
      "a DELETE, then a rename Nextly writes",
      ["DELETE FROM notes", ...RENAMES, FAILS],
    ],
    [
      "a DELETE made by a procedure, then a schema statement",
      [
        "CREATE PROCEDURE empty_notes() DELETE FROM notes",
        "CALL empty_notes()",
        ALTERS,
        FAILS,
      ],
    ],
  ])(
    "keeps the rows of %s, and says the file is partly applied",
    async (_name, statements) => {
      expect(await ran(statements)).toMatchObject({ rows: 0, partly: true });
    },
    60_000
  );

  it.each([
    [
      "a schema statement MySQL cannot parse",
      ["DELETE FROM notes", "ALTER TABLE notes ADD COLUMN"],
    ],
    [
      "a statement MySQL cannot parse, a plain session variable set before it",
      [
        "SET @seen = 1",
        "SET SESSION foreign_key_checks = 0",
        "DELETE FROM notes",
        "CREATE TABEL nope (id int)",
      ],
    ],
    [
      "a prepared statement MySQL cannot parse",
      ["DELETE FROM notes", "PREPARE bad FROM 'DELEET FROM notes'"],
    ],
    [
      "a read, with no commit between",
      ["DELETE FROM notes", "SELECT 1", FAILS],
    ],
    ["a rename Nextly writes, which changes no row", [...RENAMES, FAILS]],
    [
      "a user variable set from a read, then a schema statement, no row changed",
      ["SET @seen = (SELECT COUNT(*) FROM notes)", ALTERS, FAILS],
    ],
  ])(
    "brings the rows back after %s, and does not say the file is partly applied",
    async (_name, statements) => {
      expect(await ran(statements)).toMatchObject({ rows: 2, partly: false });
    },
    60_000
  );
});
