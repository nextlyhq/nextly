import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { sqliteTableRebuildStatements } from "../../pipeline/sql-templates/sqlite-rebuild";
import {
  assertNoForeignDrops,
  readLiveColumns,
  readLiveElements,
} from "../zz-old-drop-guard-tmp";

let handle: TestNextly;
beforeEach(async () => {
  handle = await createTestNextly({});
});
afterEach(async () => {
  await handle?.destroy();
});

async function judge(statements: string[], owned: string[]) {
  const db = handle.adapter.getDrizzle();
  try {
    assertNoForeignDrops({
      statements,
      stream: "app",
      owners: new Map(),
      elementOwners: [],
      dialect: "sqlite",
      source: "app/x",
      ownedElements: {
        users: { columns: owned, indexes: [], foreignKeys: [], checks: [] },
      },
      liveColumns: await readLiveColumns(db, "sqlite", [statements]),
      liveElements: await readLiveElements(db, "sqlite", [statements]),
      liveTables: new Set(["users"]),
    });
    return "ALLOWED";
  } catch (e) {
    return (
      "REFUSED " +
      JSON.stringify((e as any).logContext) +
      " " +
      (e as any).publicMessage
    );
  }
}
async function users() {
  return (
    await introspectLiveSnapshot(handle.adapter.getDrizzle(), "sqlite", [
      "users",
    ])
  ).tables[0];
}

it("A: generator adds contributed column with now() default to core users by rebuild", async () => {
  const u = await users();
  const column = {
    name: "gs_stamp",
    type: "integer",
    nullable: true,
    default: "(strftime('%s', 'now'))",
  } as any;
  const stmts = sqliteTableRebuildStatements(
    { ...u, columns: [...u.columns, column] },
    [{ type: "add_column", tableName: "users", column }]
  );
  console.log("A", stmts.join("\n"), "\n=>", await judge(stmts, []));
});

it("B: change default of contributed column", async () => {
  await handle.adapter.executeQuery(
    `ALTER TABLE users ADD COLUMN gs_flag text DEFAULT 'a'`
  );
  const u = await users();
  const stmts = sqliteTableRebuildStatements({
    ...u,
    columns: u.columns.map(c =>
      c.name === "gs_flag" ? { ...c, default: "'b'" } : c
    ),
    checks: [
      ...(u.checks ?? []),
      { name: "users_gs_chk", sql: `"gs_flag" <> ''` },
    ],
  });
  console.log("B =>", await judge(stmts, ["gs_flag"]));
});

it("C: contributed column NOT NULL relaxed", async () => {
  await handle.adapter.executeQuery(
    `ALTER TABLE users ADD COLUMN gs_req text NOT NULL DEFAULT 'a'`
  );
  const u = await users();
  const stmts = sqliteTableRebuildStatements({
    ...u,
    columns: u.columns.map(c =>
      c.name === "gs_req" ? { ...c, nullable: true } : c
    ),
    checks: [...(u.checks ?? []), { name: "users_gs_chk", sql: `1 = 1` }],
  });
  console.log("C =>", await judge(stmts, ["gs_req"]));
});
