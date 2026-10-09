/**
 * An index dropped by its name alone, judged against a real database on
 * every configured dialect: the guard learns the index's table from the live
 * catalog (`readLiveIndexTables`), so a plugin module dropping the app's
 * index is refused, while its own index, or one the database does not have,
 * takes nothing. MySQL's `DROP INDEX` names its table, so there nothing is
 * read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { splitSqlStatements } from "../../migrate/split-sql";
import { assertNoForeignDrops, readLiveIndexTables } from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

/** The app's table, and its index the plugin module must not take. */
const APP_TABLE = "ge_people";
const APP_INDEX = "ge_people_name_idx";
/** The plugin's own table, and its index the module may drop. */
const PLUGIN_TABLE = "ge_things";
const PLUGIN_INDEX = "ge_things_name_idx";

const owners = new Map<string, OwnerRecord>([
  [
    PLUGIN_TABLE,
    {
      tableName: PLUGIN_TABLE,
      ownerKind: "plugin",
      ownerId: "ge",
      migratedBy: "plugin:ge",
      ownerVersion: "1.0.0",
      schemaVersion: 1,
      state: "active",
    },
  ],
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
  "an index dropped by name, judged against a live database (%s)",
  dialect => {
    let handle: TestNextly;

    /** How this dialect drops `table`'s index by name. */
    const dropIndex = (name: string, table: string): string =>
      dialect === "mysql"
        ? `DROP INDEX ${name} ON ${table}`
        : `DROP INDEX ${name}`;

    /** Judges `sql` as a module of `plugin:ge`, with live state read. */
    async function judge(sql: string): Promise<void> {
      const statements = splitSqlStatements(sql, dialect);
      assertNoForeignDrops({
        statements,
        stream: "plugin:ge",
        owners,
        elementOwners: [],
        dialect,
        source: "plugin:ge/0001_under_test",
        liveIndexTables: await readLiveIndexTables(
          handle.adapter.getDrizzle(),
          dialect,
          [statements]
        ),
      });
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await handle.adapter.executeQuery(
        `CREATE TABLE ${APP_TABLE} (id varchar(36) PRIMARY KEY, name varchar(64))`
      );
      await handle.adapter.executeQuery(
        `CREATE INDEX ${APP_INDEX} ON ${APP_TABLE} (name)`
      );
      await handle.adapter.executeQuery(
        `CREATE TABLE ${PLUGIN_TABLE} (id varchar(36) PRIMARY KEY, name varchar(64))`
      );
      await handle.adapter.executeQuery(
        `CREATE INDEX ${PLUGIN_INDEX} ON ${PLUGIN_TABLE} (name)`
      );
    });

    afterEach(async () => {
      await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${APP_TABLE}`);
      await handle?.adapter.executeQuery(
        `DROP TABLE IF EXISTS ${PLUGIN_TABLE}`
      );
      await handle?.destroy();
    });

    it.runIf(dialect !== "mysql")(
      "reads the table an index named alone is on",
      async () => {
        const found = await readLiveIndexTables(
          handle.adapter.getDrizzle(),
          dialect,
          [[`DROP INDEX ${APP_INDEX.toUpperCase()}`, "DROP INDEX ge_gone"]]
        );
        expect([...found]).toEqual([[APP_INDEX, APP_TABLE]]);
        const own = await readLiveIndexTables(
          handle.adapter.getDrizzle(),
          dialect,
          [[`DROP INDEX ${PLUGIN_INDEX}`]]
        );
        expect([...own]).toEqual([[PLUGIN_INDEX, PLUGIN_TABLE]]);
      }
    );

    it("refuses a plugin module dropping the app's index", async () => {
      await expect(
        judge(dropIndex(APP_INDEX, APP_TABLE))
      ).rejects.toMatchObject({
        code: "DROP_OF_FOREIGN_TABLE",
        logContext: {
          table: APP_TABLE,
          element: APP_INDEX,
          belongsTo: "app",
        },
      });
    });

    it("allows a plugin module dropping its own table's index", async () => {
      // The control: the same statement, naming the plugin's own index.
      await expect(
        judge(dropIndex(PLUGIN_INDEX, PLUGIN_TABLE))
      ).resolves.toBeUndefined();
    });

    it.runIf(dialect !== "mysql")(
      "allows dropping an index the database does not have",
      async () => {
        await expect(
          judge("DROP INDEX IF EXISTS ge_gone")
        ).resolves.toBeUndefined();
      }
    );
  }
);
