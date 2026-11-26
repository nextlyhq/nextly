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
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { planEntityMoves } from "../../field-moves/plan-moves";
import { mysqlLiveStatements } from "../../pipeline/sql-templates/mysql-live-restate";
import { runMigrationStatements } from "../migration-transaction";
import { splitSqlStatements } from "../split-sql";

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

const SUBTITLE = {
  name: "subtitle",
  label: "Subtitle",
  type: "text",
  required: true,
} as FieldDefinition;
const meta = (fields: FieldDefinition[]) =>
  ({ name: "meta", label: "Meta", type: "group", fields }) as FieldDefinition;
const OUTSIDE = [SUBTITLE, meta([])];
const INSIDE = [meta([SUBTITLE])];

/**
 * The statements a field's move plans for `pages`, as its file runs them: its stops and the writes
 * before its changes (`first`), and the writes after them (`last`).
 */
function moved(
  before: FieldDefinition[],
  after: FieldDefinition[],
  move: { from: string[]; to: string[] }
): { first: string[]; last: string[] } {
  const { up } = planEntityMoves({
    before,
    after,
    moves: [move],
    table: "pages",
    dialect: "mysql",
    localized: false,
    kind: "collection",
  });
  return {
    // The stops lead the file, before every move's writes, as the planner places them apart.
    first: splitSqlStatements([...up.stops, ...up.first].join("\n"), "mysql"),
    last: splitSqlStatements(up.last.join("\n"), "mysql"),
  };
}

/** A required field moved out of a group: its first statements are its stops, each in a temporary table. */
const MOVES_OUT = moved(INSIDE, OUTSIDE, {
  from: ["meta", "subtitle"],
  to: ["subtitle"],
});
/** The same field moved into the group: its first statements are its copies. */
const MOVES_IN = moved(OUTSIDE, INSIDE, {
  from: ["subtitle"],
  to: ["meta", "subtitle"],
});

const ADDS_SUBTITLE = "ALTER TABLE `pages` ADD COLUMN `subtitle` varchar(255)";

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
    await adapter.executeQuery(
      "CREATE TABLE parted (id int PRIMARY KEY) PARTITION BY RANGE (id) (PARTITION low VALUES LESS THAN (10), PARTITION high VALUES LESS THAN (100))"
    );
    await adapter.executeQuery("INSERT INTO parted (id) VALUES (1), (50)");
    await adapter.executeQuery("CREATE TABLE spare (id int PRIMARY KEY)");
    await adapter.executeQuery(
      "CREATE TABLE pages (id int PRIMARY KEY, meta json)"
    );
    await adapter.executeQuery(
      `INSERT INTO pages (id, meta) VALUES (1, '{"subtitle":"one"}'), (2, '{"subtitle":"two"}')`
    );
  }, 60_000);

  afterEach(async () => {
    await adapter.disconnect();
    await drop().catch(() => undefined);
  }, 60_000);

  /**
   * A LOAD DATA of two rows from a file the server wrote itself, under one name it keeps, since no
   * statement removes one: undefined where the server reads and writes no file (`secure_file_priv`).
   */
  async function loadedRows(): Promise<string | undefined> {
    const [{ dir }] = (await adapter.executeQuery(
      "SELECT @@secure_file_priv AS dir"
    )) as unknown as [{ dir: string | null }];
    if (dir === null) return undefined;
    const file = `${dir === "" ? "/tmp/" : dir}nextly_durable_rows.csv`;
    await adapter
      .executeQuery(
        `SELECT 10, 'ten' UNION SELECT 11, 'eleven' INTO OUTFILE '${file}'`
      )
      .catch((error: unknown) => {
        // There from an earlier run, with the same two rows.
        if (!String((error as Error).message).includes("already exists")) {
          throw error;
        }
      });
    return `LOAD DATA INFILE '${file}' INTO TABLE notes (id, body)`;
  }

  /** The rows `counting` reads and whether the failure says part of the file stayed applied. */
  async function ran(
    statements: readonly string[],
    counting = "SELECT COUNT(*) AS n FROM notes"
  ): Promise<{ rows: number; partly: boolean; code: string }> {
    const error = await runMigrationStatements(adapter, statements, {
      source: "20261124_000000_000_notes.sql",
      transaction: true,
    }).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(error, "the file fails").toBeDefined();
    const [{ n }] = (await adapter.executeQuery(counting)) as unknown as [
      { n: unknown },
    ];
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
    [
      "a DELETE, then a partition dropped",
      ["DELETE FROM notes", "ALTER TABLE parted DROP PARTITION low", FAILS],
    ],
    [
      "a rename Nextly writes, then a DELETE",
      [...RENAMES, "DELETE FROM notes", FAILS],
    ],
    [
      "a view, whose CREATE commits, then a DELETE",
      [
        "CREATE VIEW notes_view AS SELECT id FROM notes",
        "DELETE FROM notes",
        FAILS,
      ],
    ],
    [
      "a DELETE before a savepoint, the rest rolled back to it, then a schema statement",
      [
        "DELETE FROM notes",
        "SAVEPOINT emptied",
        "INSERT INTO notes (id, body) VALUES (3, 'three')",
        "ROLLBACK TO SAVEPOINT emptied",
        ALTERS,
        FAILS,
      ],
    ],
    ["a COMMIT, then a DELETE", ["COMMIT", "DELETE FROM notes", FAILS]],
    ["a ROLLBACK, then a DELETE", ["ROLLBACK", "DELETE FROM notes", FAILS]],
  ])(
    "keeps the rows of %s, and says the file is partly applied",
    async (_name, statements) => {
      expect(await ran(statements)).toMatchObject({ rows: 0, partly: true });
    },
    60_000
  );

  // The rows are another table's, or ones a statement brings in, so each case says which it counts.
  it.each([
    [
      "a partition dropped",
      ["ALTER TABLE parted DROP PARTITION low", FAILS],
      "SELECT COUNT(*) AS n FROM parted",
      1,
    ],
    [
      "a partition emptied",
      ["ALTER TABLE parted TRUNCATE PARTITION low", FAILS],
      "SELECT COUNT(*) AS n FROM parted",
      1,
    ],
    [
      "a partition exchanged for a table",
      ["ALTER TABLE parted EXCHANGE PARTITION low WITH TABLE spare", FAILS],
      "SELECT COUNT(*) AS n FROM parted",
      1,
    ],
    [
      "a table made from another",
      ["CREATE TABLE copied TABLE notes", FAILS],
      "SELECT COUNT(*) AS n FROM copied",
      2,
    ],
    [
      "a table made from rows written out",
      ["CREATE TABLE copied VALUES ROW(1), ROW(2)", FAILS],
      "SELECT COUNT(*) AS n FROM copied",
      2,
    ],
    [
      "a table made and filled from a read",
      ["CREATE TABLE copied SELECT id FROM notes", FAILS],
      "SELECT COUNT(*) AS n FROM copied",
      2,
    ],
    [
      "a table made with its columns and filled from a read",
      [
        "CREATE TABLE copied (id int PRIMARY KEY) AS SELECT id FROM notes",
        FAILS,
      ],
      "SELECT COUNT(*) AS n FROM copied",
      2,
    ],
  ])(
    "keeps the rows of %s, and says the file is partly applied",
    async (_name, statements, counting, rows) => {
      expect(await ran(statements, counting)).toMatchObject({
        rows,
        partly: true,
      });
    },
    60_000
  );

  // MySQL keeps no row of a load the transaction undoes: it does not commit (on InnoDB).
  it("brings the rows back after a file loaded, and does not say the file is partly applied", async ({
    skip,
  }) => {
    const loads = await loadedRows();
    if (loads === undefined) return skip();
    expect(
      await ran([loads, FAILS], "SELECT COUNT(*) AS n FROM notes")
    ).toMatchObject({ rows: 2, partly: false });
  }, 60_000);

  it("keeps the rows of a file loaded, then a schema statement, and says the file is partly applied", async ({
    skip,
  }) => {
    const loads = await loadedRows();
    if (loads === undefined) return skip();
    expect(
      await ran([loads, ALTERS, FAILS], "SELECT COUNT(*) AS n FROM notes")
    ).toMatchObject({ rows: 4, partly: true });
  }, 60_000);

  it("a move out of a group starts with stops that write to a temporary table", () => {
    expect(MOVES_OUT.first[0]).toContain("CREATE TEMPORARY TABLE");
    expect(MOVES_OUT.first[1]).toContain("INSERT INTO");
    expect(MOVES_OUT.first.some(sql => sql.includes("UPDATE"))).toBe(false);
  });

  // The move's stops write rows to a temporary table, which a failure after them leaves nobody.
  it.each([
    [
      "its first ALTER, of a column already there",
      [...MOVES_OUT.first, "ALTER TABLE `pages` ADD COLUMN `meta` json"],
    ],
    [
      "the statement after its first ALTER",
      [...MOVES_OUT.first, ADDS_SUBTITLE, FAILS],
    ],
    [
      "the statement after its copies, whose transaction the run opened again",
      [...MOVES_OUT.first, ADDS_SUBTITLE, ...MOVES_OUT.last, FAILS],
    ],
  ])(
    "leaves every value in the group where a field's move fails at %s, and does not say the file is partly applied",
    async (_name, statements) => {
      // The move's stops are run, or the case says nothing of the rows they write.
      expect(
        statements.filter(sql => /CREATE TEMPORARY TABLE/i.test(sql)),
        "the move's stops"
      ).not.toEqual([]);
      expect(
        await ran(
          statements,
          "SELECT COUNT(*) AS n FROM pages WHERE JSON_EXTRACT(meta, '$.subtitle') IS NOT NULL"
        )
      ).toMatchObject({ rows: 2, partly: false });
    },
    60_000
  );

  it("keeps the values a move out of a group copied, then a schema statement, and says the file is partly applied", async () => {
    expect(
      await ran(
        [
          ...MOVES_OUT.first,
          ADDS_SUBTITLE,
          ...MOVES_OUT.last,
          "ALTER TABLE `pages` MODIFY `subtitle` varchar(255) NOT NULL",
          FAILS,
        ],
        "SELECT COUNT(*) AS n FROM pages WHERE subtitle IS NOT NULL"
      )
    ).toMatchObject({ rows: 2, partly: true });
  }, 60_000);

  it("keeps the values a move into a group copied, then its column dropped, and says the file is partly applied", async () => {
    await adapter.executeQuery(ADDS_SUBTITLE);
    await adapter.executeQuery(
      "UPDATE pages SET meta = NULL, subtitle = CONCAT('value ', id)"
    );
    expect(
      await ran(
        [
          ...MOVES_IN.first,
          "ALTER TABLE `pages` DROP COLUMN `subtitle`",
          FAILS,
        ],
        "SELECT COUNT(*) AS n FROM pages WHERE JSON_EXTRACT(meta, '$.subtitle') IS NOT NULL"
      )
    ).toMatchObject({ rows: 2, partly: true });
  }, 60_000);

  it.each([
    ["dropped again", ["DROP TEMPORARY TABLE `notes`", "DELETE FROM `notes`"]],
    [
      "dropped again without saying it is temporary",
      ["DROP TABLE `notes`", "DELETE FROM `notes`"],
    ],
    [
      "renamed",
      ["ALTER TABLE `notes` RENAME TO `seen`", "DELETE FROM `notes`"],
    ],
    [
      "dropped again by a prepared statement",
      [
        "PREPARE gone FROM 'DROP TEMPORARY TABLE `notes`'",
        "EXECUTE gone",
        "DELETE FROM `notes`",
      ],
    ],
  ])(
    "keeps the rows of a DELETE from a table whose name a temporary one had until it was %s, and says the file is partly applied",
    async (_name, statements) => {
      expect(
        await ran([
          "CREATE TEMPORARY TABLE `notes` (id int)",
          ...statements,
          ALTERS,
          FAILS,
        ])
      ).toMatchObject({ rows: 0, partly: true });
    },
    60_000
  );

  it.each([
    [
      "a table the file did not make, beside one it did",
      ["CREATE TEMPORARY TABLE `seen` (id int)", "DELETE FROM `notes`"],
    ],
    [
      "two tables, one of them temporary",
      [
        "CREATE TEMPORARY TABLE `seen` SELECT id FROM notes",
        "DELETE `seen`, `notes` FROM `seen` JOIN `notes` ON `seen`.id = `notes`.id",
      ],
    ],
  ])(
    "keeps the rows of a DELETE from %s, and says the file is partly applied",
    async (_name, statements) => {
      expect(await ran([...statements, ALTERS, FAILS])).toMatchObject({
        rows: 0,
        partly: true,
      });
    },
    60_000
  );

  // Where the server tells names apart by case (Linux), `Notes` is another table than `notes`.
  it("keeps the rows of a DELETE from a table whose name a temporary one has in another case, and says the file is partly applied", async ({
    skip,
  }) => {
    const [{ folds }] = (await adapter.executeQuery(
      "SELECT @@lower_case_table_names AS folds"
    )) as unknown as [{ folds: unknown }];
    if (Number(folds) !== 0) return skip();
    expect(
      await ran([
        "CREATE TEMPORARY TABLE Notes (id int)",
        "DELETE FROM notes",
        ALTERS,
        FAILS,
      ])
    ).toMatchObject({ rows: 0, partly: true });
  }, 60_000);

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
    [
      "a partitioned table made, which no query fills",
      [
        "CREATE TABLE made (id int PRIMARY KEY) PARTITION BY RANGE (id) (PARTITION p0 VALUES LESS THAN (10))",
        FAILS,
      ],
    ],
    [
      "a partition added, which changes no row",
      [
        "ALTER TABLE parted ADD PARTITION (PARTITION top VALUES LESS THAN (1000))",
        FAILS,
      ],
    ],
    [
      "a DELETE undone by a ROLLBACK, then a schema statement",
      ["DELETE FROM notes", "ROLLBACK", ALTERS, FAILS],
    ],
    [
      "a DELETE undone by a ROLLBACK, with nothing after it but the failure",
      ["DELETE FROM notes", "ROLLBACK", FAILS],
    ],
    [
      "a DELETE after a schema statement, whose transaction the run opened again",
      [ALTERS, "DELETE FROM notes", FAILS],
    ],
    [
      "a DELETE after a CREATE TEMPORARY TABLE filled from a read",
      [
        "DELETE FROM notes",
        "CREATE TEMPORARY TABLE seen SELECT id FROM notes",
        FAILS,
      ],
    ],
    [
      "rows written to a temporary table the file made, then a schema statement",
      [
        "CREATE TEMPORARY TABLE IF NOT EXISTS `seen` (id int)",
        "INSERT INTO `seen` (id) SELECT id FROM notes",
        "UPDATE `seen` SET id = 3 WHERE id = 1",
        "DELETE FROM `seen` WHERE id = 2",
        ALTERS,
        "INSERT INTO `seen` (id) VALUES (4)",
        "ALTER TABLE notes DROP COLUMN added",
        FAILS,
      ],
    ],
  ])(
    "brings the rows back after %s, and does not say the file is partly applied",
    async (_name, statements) => {
      expect(await ran(statements)).toMatchObject({ rows: 2, partly: false });
    },
    60_000
  );
});
