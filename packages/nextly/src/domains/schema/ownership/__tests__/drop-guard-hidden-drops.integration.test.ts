/**
 * The hidden drops `drop-guard-hidden-drops.test.ts` reads from text, judged
 * against a real database on every configured dialect: the guard refuses
 * each with the live tables read from that database, and the controls it
 * allows are SQL the database runs.
 *
 * On PostgreSQL each refused shape is also run, after the refusal, to show
 * what the refusal keeps from happening: a string-bodied function called
 * later drops the table, and `DROP TYPE ... CASCADE` removes another
 * table's column of that type.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { splitSqlStatements } from "../../migrate/split-sql";
import { queryLiveColumnTypes } from "../../pipeline/live-column-types";
import {
  assertNoForeignDrops,
  readLiveTables,
  UnparsableDropTarget,
} from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

/** The app's table the plugin module must not take. */
const APP_TABLE = "hd_people";

const owners = new Map<string, OwnerRecord>([
  [
    APP_TABLE,
    {
      tableName: APP_TABLE,
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
      ownerVersion: null,
      schemaVersion: null,
      state: "active",
    },
  ],
]);

describe.each(getConfiguredTestDialects())(
  "hidden drops judged against a live database (%s)",
  dialect => {
    let handle: TestNextly;

    /** Runs `sql`, split as the runner splits it, one statement at a time. */
    async function run(sql: string): Promise<void> {
      for (const statement of splitSqlStatements(sql, dialect)) {
        await handle.adapter.executeQuery(statement);
      }
    }

    /** Judges `sql` as a module of `plugin:hd`, with live tables read. */
    async function judge(sql: string): Promise<void> {
      const statements = splitSqlStatements(sql, dialect);
      assertNoForeignDrops({
        statements,
        stream: "plugin:hd",
        owners,
        elementOwners: [],
        dialect,
        source: "plugin:hd/0001_under_test",
        liveTables: await readLiveTables(handle.adapter.getDrizzle(), dialect, [
          statements,
        ]),
      });
    }

    async function columnsOf(table: string): Promise<string[]> {
      const live = await queryLiveColumnTypes(
        handle.adapter.getDrizzle(),
        dialect,
        [table]
      );
      return [...(live.get(table)?.keys() ?? [])].sort();
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await handle.adapter.executeQuery(
        `CREATE TABLE ${APP_TABLE} (id varchar(36) PRIMARY KEY)`
      );
    });

    afterEach(async () => {
      for (const table of [APP_TABLE, "hd_fresh"]) {
        await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
      }
      if (dialect === "postgresql") {
        await handle?.adapter.executeQuery("DROP FUNCTION IF EXISTS hd_wipe()");
        await handle?.adapter.executeQuery("DROP TYPE IF EXISTS hd_role");
      }
      await handle?.destroy();
    });

    it("refuses CREATE OR REPLACE TABLE of the app's table", async () => {
      await expect(
        judge(`CREATE OR REPLACE TABLE ${APP_TABLE} (id int)`)
      ).rejects.toMatchObject({
        code: "DROP_OF_FOREIGN_TABLE",
        logContext: { table: APP_TABLE, belongsTo: "app" },
      });
    });

    it("allows a module's own new table, created without OR REPLACE", async () => {
      const sql = "CREATE TABLE hd_fresh (id int);\nDROP TABLE hd_fresh;";
      await expect(judge(sql)).resolves.toBeUndefined();
      await run(sql);
      expect(await handle.adapter.tableExists("hd_fresh")).toBe(false);
    });

    it.runIf(dialect === "postgresql")(
      "refuses a string-bodied function whose call would drop the table",
      async () => {
        const sql = `CREATE FUNCTION hd_wipe() RETURNS void LANGUAGE plpgsql AS 'BEGIN DROP TABLE ${APP_TABLE}; END';\nSELECT hd_wipe();`;
        await expect(judge(sql)).rejects.toBeInstanceOf(UnparsableDropTarget);
        // What the refusal prevents: the database runs the string as code.
        await run(sql);
        expect(await handle.adapter.tableExists(APP_TABLE)).toBe(false);
      }
    );

    it.runIf(dialect === "postgresql")(
      "allows the same function dollar-quoted, dropping only its own table",
      async () => {
        const sql =
          "CREATE TABLE hd_fresh (id int);\nCREATE FUNCTION hd_wipe() RETURNS void LANGUAGE plpgsql AS $$ BEGIN DROP TABLE hd_fresh; END $$;\nSELECT hd_wipe();";
        await expect(judge(sql)).resolves.toBeUndefined();
        await run(sql);
        expect(await handle.adapter.tableExists("hd_fresh")).toBe(false);
        expect(await handle.adapter.tableExists(APP_TABLE)).toBe(true);
      }
    );

    it.runIf(dialect === "postgresql")(
      "refuses DROP TYPE ... CASCADE, which takes the app's column",
      async () => {
        await run(
          `CREATE TYPE hd_role AS ENUM ('a', 'b');\nALTER TABLE ${APP_TABLE} ADD COLUMN role hd_role;`
        );
        await expect(judge("DROP TYPE hd_role CASCADE")).rejects.toBeInstanceOf(
          UnparsableDropTarget
        );
        // What the refusal prevents: the column goes with the type.
        await run("DROP TYPE hd_role CASCADE");
        expect(await columnsOf(APP_TABLE)).toEqual(["id"]);
      }
    );

    it.runIf(dialect === "postgresql")(
      "allows DROP TYPE without CASCADE of a type the module created",
      async () => {
        const sql =
          "CREATE TYPE hd_role AS ENUM ('a', 'b');\nCREATE TABLE hd_fresh (id int, role hd_role);\nDROP TABLE hd_fresh;\nDROP TYPE hd_role;";
        await expect(judge(sql)).resolves.toBeUndefined();
        await run(sql);
        expect(await handle.adapter.tableExists("hd_fresh")).toBe(false);
      }
    );
  }
);
