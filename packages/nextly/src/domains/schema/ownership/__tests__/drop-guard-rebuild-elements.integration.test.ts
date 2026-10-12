/**
 * A SQLite rebuild judged against a real database: the guard reads the
 * rebuilt table's indexes, foreign keys and checks from the live catalog
 * (`readLiveElements`), so a plugin's rebuild of the app's table that leaves
 * out the app's index is refused, while one that puts every element back
 * keeps the table. Only SQLite rebuilds a table this way.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { TableSpec } from "../../pipeline/diff/types";
import { sqliteTableRebuildStatements } from "../../pipeline/sql-templates/sqlite-rebuild";
import {
  assertNoForeignDrops,
  readLiveColumns,
  readLiveElements,
} from "../drop-guard";
import type { OwnerRecord } from "../owner-registry";

/** The app's table, with a named check, a named foreign key and an index. */
const TABLE = "gr_people";
const PARENT = "gr_teams";

const owners = new Map<string, OwnerRecord>([
  [
    TABLE,
    {
      tableName: TABLE,
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
      ownerVersion: null,
      schemaVersion: null,
      state: "active",
    },
  ],
]);

/** `gr_people` as the pipeline would rebuild it to add plugin gr's check. */
function rebuild(withIndex: boolean): string[] {
  const spec: TableSpec = {
    name: TABLE,
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "name", type: "text", nullable: true },
      { name: "team_id", type: "text", nullable: true },
    ],
    indexes: withIndex
      ? [{ name: "gr_people_name_idx", columns: ["name"], unique: false }]
      : [],
    foreignKeys: [
      {
        name: "gr_people_team_fk",
        columns: ["team_id"],
        referencesTable: PARENT,
        referencesColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
    ],
    checks: [
      { name: "gr_people_name_check", sql: `"name" <> ''` },
      { name: "gr_people_name_gr", sql: `"name" <> 'x'` },
    ],
  };
  return sqliteTableRebuildStatements(spec);
}

describe("a SQLite rebuild judged against a live database", () => {
  let handle: TestNextly;

  async function judge(statements: string[]): Promise<void> {
    const db = handle.adapter.getDrizzle();
    assertNoForeignDrops({
      statements,
      stream: "plugin:gr",
      owners,
      elementOwners: [...owners.values()],
      dialect: "sqlite",
      source: "plugin:gr/0001_under_test",
      liveColumns: await readLiveColumns(db, "sqlite", [statements]),
      liveElements: await readLiveElements(db, "sqlite", [statements]),
      liveTables: new Set([TABLE, PARENT]),
    });
  }

  beforeEach(async () => {
    handle = await createTestNextly({});
    await handle.adapter.executeQuery(
      `CREATE TABLE ${PARENT} (id text PRIMARY KEY)`
    );
    await handle.adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id text PRIMARY KEY, name text, team_id text, ` +
        `CONSTRAINT "gr_people_name_check" CHECK ("name" <> ''), ` +
        `CONSTRAINT "gr_people_team_fk" FOREIGN KEY ("team_id") REFERENCES ${PARENT} ("id") ON DELETE CASCADE)`
    );
    await handle.adapter.executeQuery(
      `CREATE INDEX gr_people_name_idx ON ${TABLE} (name)`
    );
  });

  afterEach(async () => {
    await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${PARENT}`);
    await handle?.destroy();
  });

  it("reads the table's indexes, foreign keys and checks", async () => {
    const live = await readLiveElements(handle.adapter.getDrizzle(), "sqlite", [
      rebuild(true),
    ]);
    // Beside them, the table's shape (`drop-guard-rebuild-shape`).
    expect(live.get(TABLE)).toMatchObject({
      index: new Set(["gr_people_name_idx"]),
      fk: new Set(["gr_people_team_fk"]),
      check: new Set(["gr_people_name_check"]),
    });
  });

  it("refuses a plugin's rebuild that leaves out the app's index", async () => {
    await expect(judge(rebuild(false))).rejects.toMatchObject({
      code: "DROP_OF_FOREIGN_TABLE",
      logContext: {
        table: TABLE,
        element: "gr_people_name_idx",
        belongsTo: "app",
      },
    });
  });

  it("allows a plugin's rebuild that puts every element back", async () => {
    // The control: the same rebuild, recreating the index.
    await expect(judge(rebuild(true))).resolves.toBeUndefined();
  });
});
