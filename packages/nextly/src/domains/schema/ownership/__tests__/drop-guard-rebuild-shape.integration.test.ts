/**
 * A SQLite rebuild of another owner's table judged against a real database:
 * the guard reads the table's key, unique constraints, column definitions
 * and triggers from the live catalog (`readLiveElements`). The pipeline's own
 * rebuild of the core `users` table, which keeps all of them, is allowed to
 * the app; the same rebuild losing a column's NOT NULL is refused. Only
 * SQLite rebuilds a table this way.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import type { TableSpec } from "../../pipeline/diff/types";
import { sqliteTableRebuildStatements } from "../../pipeline/sql-templates/sqlite-rebuild";
import {
  assertNoForeignDrops,
  readLiveColumns,
  readLiveElements,
} from "../drop-guard";

/** A hand-made table with an inline unique constraint and a trigger. */
const TABLE = "gs_tags";

describe("a SQLite rebuild's shape judged against a live database", () => {
  let handle: TestNextly;

  async function judge(statements: string[], stream: string): Promise<void> {
    const db = handle.adapter.getDrizzle();
    assertNoForeignDrops({
      statements,
      stream,
      owners: new Map(),
      elementOwners: [],
      dialect: "sqlite",
      source: `${stream}/0001_under_test`,
      liveColumns: await readLiveColumns(db, "sqlite", [statements]),
      liveElements: await readLiveElements(db, "sqlite", [statements]),
      liveTables: new Set(["users", TABLE]),
    });
  }

  /** Core `users` as the database holds it, with a check contributed. */
  async function usersWithCheck(
    change: (spec: TableSpec) => TableSpec = spec => spec
  ): Promise<string[]> {
    const [users] = (
      await introspectLiveSnapshot(handle.adapter.getDrizzle(), "sqlite", [
        "users",
      ])
    ).tables;
    return sqliteTableRebuildStatements(
      change({
        ...users,
        checks: [
          ...(users.checks ?? []),
          { name: "users_email_gs", sql: `"email" <> ''` },
        ],
      })
    );
  }

  beforeEach(async () => {
    handle = await createTestNextly({});
    await handle.adapter.executeQuery(
      `CREATE TABLE ${TABLE} (id text PRIMARY KEY, code text UNIQUE, label text NOT NULL DEFAULT 'x')`
    );
    await handle.adapter.executeQuery(
      `CREATE TRIGGER gs_tags_touch AFTER UPDATE ON ${TABLE} BEGIN SELECT 1; END`
    );
  });

  afterEach(async () => {
    await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
    await handle?.destroy();
  });

  it("allows the pipeline's rebuild of core users to the app", async () => {
    await expect(judge(await usersWithCheck(), "app")).resolves.toBeUndefined();
  });

  it("refuses the same rebuild losing a column's NOT NULL", async () => {
    const loosened = await usersWithCheck(spec => ({
      ...spec,
      columns: spec.columns.map(column =>
        column.name === "email" ? { ...column, nullable: true } : column
      ),
    }));
    await expect(judge(loosened, "app")).rejects.toMatchObject({
      code: "DROP_OF_FOREIGN_TABLE",
      logContext: { table: "users", droppedBy: "app", belongsTo: "core" },
    });
  });

  it("reads a table's inline unique constraint and its triggers", async () => {
    const statements = [
      `CREATE TABLE "__new_${TABLE}" ("id" text PRIMARY KEY, "code" text UNIQUE, "label" text NOT NULL DEFAULT 'x')`,
      `INSERT INTO "__new_${TABLE}" ("id", "code", "label") SELECT "id", "code", "label" FROM "${TABLE}"`,
      `DROP TABLE "${TABLE}"`,
      `ALTER TABLE "__new_${TABLE}" RENAME TO "${TABLE}"`,
    ];
    const live = await readLiveElements(handle.adapter.getDrizzle(), "sqlite", [
      statements,
    ]);
    expect(live.get(TABLE)?.shape).toMatchObject({
      primaryKey: ["id"],
      unique: new Set(["code"]),
      triggers: 1,
    });
    // The app's own table: the trigger does not stop its own rebuild.
    await expect(judge(statements, "app")).resolves.toBeUndefined();
    // A plugin's rebuild of it would drop the trigger with the table.
    await expect(judge(statements, "plugin:gs")).rejects.toMatchObject({
      code: "DROP_OF_FOREIGN_TABLE",
      logContext: { table: TABLE, belongsTo: null },
    });
  });
});
