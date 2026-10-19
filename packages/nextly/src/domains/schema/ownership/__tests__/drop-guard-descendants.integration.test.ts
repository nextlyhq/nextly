/**
 * A table's descendants, read from a real database: on PostgreSQL the tables
 * that inherit from it and its partitions, which `ALTER TABLE` without
 * `ONLY`, `TRUNCATE` without `ONLY` and `DROP TABLE` reach too, though the
 * statement names none of them. The guard learns them from the live catalog
 * (`readLiveTables`), so an app migration altering its own table is refused
 * when a plugin's table inherits from it, while the same change written with
 * `ONLY` still passes. MySQL and SQLite have no inheritance, so there the
 * reading is empty and nothing changes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { splitSqlStatements } from "../../migrate/split-sql";
import { assertNoForeignDrops, readLiveTables } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

/** The app's table, which a plugin's table inherits from. */
const PARENT = "dd_parent";
/** The plugin's table, inheriting from the app's. */
const CHILD = "dd_child";
/** Another plugin's table, inheriting from the plugin's: a grandchild. */
const GRANDCHILD = "dd_grandchild";
/** The app's partitioned table, and the plugin's partition of it. */
const EVENTS = "dd_events";
const PARTITION = "dd_events_dd";

function plugin(tableName: string, name: string): [string, OwnerRecord] {
  return [
    tableName,
    {
      tableName,
      ownerKind: "plugin",
      ownerId: name,
      migratedBy: `plugin:${name}`,
      ownerVersion: "1.0.0",
      schemaVersion: 1,
      state: "active",
    },
  ];
}

/** No row names the app's tables: a table no row claims is the app's. */
const owners = new Map<string, OwnerRecord>([
  plugin(CHILD, "dd"),
  plugin(GRANDCHILD, "other"),
  plugin(PARTITION, "dd"),
]);

describe.each(getConfiguredTestDialects())(
  "a statement reaching a table's descendants, judged against a live database (%s)",
  dialect => {
    let handle: TestNextly;
    const isPostgres = dialect === "postgresql";

    /** Judges `sql` as an app migration, with the live tables read. */
    async function judge(sql: string): Promise<void> {
      const statements = splitSqlStatements(sql, dialect);
      assertNoForeignDrops({
        statements,
        stream: "app",
        owners,
        elementOwners: [...owners.values()],
        dialect,
        source: "0001_under_test",
        liveTables: await readLiveTables(handle.adapter.getDrizzle(), dialect, [
          statements,
        ]),
      });
    }

    async function dropAll(): Promise<void> {
      for (const table of [GRANDCHILD, CHILD, PARENT, PARTITION, EVENTS]) {
        await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
      }
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await dropAll();
      await handle.adapter.executeQuery(
        `CREATE TABLE ${PARENT} (id varchar(36) PRIMARY KEY, name varchar(64))`
      );
      if (!isPostgres) return;
      await handle.adapter.executeQuery(
        `CREATE TABLE ${CHILD} (note text) INHERITS (${PARENT})`
      );
      await handle.adapter.executeQuery(
        `CREATE TABLE ${GRANDCHILD} () INHERITS (${CHILD})`
      );
      await handle.adapter.executeQuery(
        `CREATE TABLE ${EVENTS} (kind int, name varchar(64)) PARTITION BY LIST (kind)`
      );
      await handle.adapter.executeQuery(
        `CREATE TABLE ${PARTITION} PARTITION OF ${EVENTS} FOR VALUES IN (1)`
      );
    });

    afterEach(async () => {
      await dropAll();
      await handle?.destroy();
    });

    it.runIf(isPostgres)(
      "reads every descendant of a table a statement alters",
      async () => {
        const live = await readLiveTables(
          handle.adapter.getDrizzle(),
          dialect,
          [
            [`ALTER TABLE ${PARENT} ADD COLUMN extra int`],
            [`TRUNCATE ${EVENTS}`],
          ]
        );
        expect(
          Object.fromEntries(
            [...(live.descendants ?? new Map())].map(([table, below]) => [
              table,
              [...below].sort(),
            ])
          )
        ).toEqual({
          [PARENT]: [CHILD, GRANDCHILD].sort(),
          [EVENTS]: [PARTITION],
        });
      }
    );

    it.runIf(isPostgres)(
      "alters the plugin's child when the app alters its own table",
      async () => {
        // The control for the refusals below: PostgreSQL itself carries the
        // change to the inheriting table, which the statement never names.
        await handle.adapter.executeQuery(
          `ALTER TABLE ${PARENT} ADD COLUMN extra int`
        );
        const rows = await handle.adapter.executeQuery<{ table_name: string }>(
          `SELECT table_name FROM information_schema.columns
           WHERE column_name = 'extra' AND table_name IN ('${CHILD}', '${GRANDCHILD}')`
        );
        expect(rows.map(row => row.table_name).sort()).toEqual(
          [CHILD, GRANDCHILD].sort()
        );
      }
    );

    it.runIf(isPostgres)(
      "refuses an app migration altering its table, which the plugin's table inherits",
      async () => {
        await expect(
          judge(`ALTER TABLE ${PARENT} ADD COLUMN extra int`)
        ).rejects.toMatchObject({
          code: "DROP_OF_FOREIGN_TABLE",
          logContext: { table: CHILD, parent: PARENT, belongsTo: "plugin:dd" },
        });
      }
    );

    it.runIf(isPostgres)(
      "refuses emptying the app's partitioned table, which holds the plugin's partition",
      async () => {
        await expect(judge(`TRUNCATE ${EVENTS}`)).rejects.toMatchObject({
          code: "DROP_OF_FOREIGN_TABLE",
          logContext: {
            table: PARTITION,
            parent: EVENTS,
            belongsTo: "plugin:dd",
          },
        });
      }
    );

    it("allows the same change written to reach the app's table alone", async () => {
      await expect(
        judge(
          `ALTER TABLE ${isPostgres ? "ONLY " : ""}${PARENT} ALTER COLUMN name SET DEFAULT 'x'`
        )
      ).resolves.toBeUndefined();
    });

    it.runIf(!isPostgres)(
      "reads no descendants where the dialect has no inheritance",
      async () => {
        const live = await readLiveTables(
          handle.adapter.getDrizzle(),
          dialect,
          [[`ALTER TABLE ${PARENT} ADD COLUMN extra int`]]
        );
        expect([...(live.descendants ?? new Map())]).toEqual([]);
        await expect(
          judge(`ALTER TABLE ${PARENT} ADD COLUMN extra int`)
        ).resolves.toBeUndefined();
      }
    );
  }
);
