/**
 * Before plugins initialise in development, an existing extension table gains
 * what its upgraded declaration added and needs no decision.
 *
 * The development push reconciles extension tables only after
 * `registerServices` — after every plugin's `init`. A plugin upgrade adding a
 * column its `init` reads therefore failed the boot, and the push that would
 * have added the column never ran. The pass before `init` now adds columns,
 * indexes and constraints to an existing table, and on every dialect the table
 * then diffs against its declaration as the push would leave it.
 */
import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../database/factory";
import { col, defineTable } from "../../domains/schema/extension/dsl";
import { compileExtensionSchema } from "../../domains/schema/extension/publish";
import { diffSnapshots } from "../../domains/schema/pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type { PluginDefinition } from "../../plugins/plugin-context";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { prepareExtensionTablesBeforeInit } from "../first-run";

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

const URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

async function connect(dialect: TestDialect): Promise<Adapter> {
  const adapter = await createAdapter(
    (dialect === "sqlite"
      ? { type: "sqlite", memory: true }
      : {
          type: dialect,
          url: process.env[URL_ENV[dialect]],
        }) as Parameters<typeof createAdapter>[0]
  );
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

const logger = {
  info: () => undefined,
  warn: (message: string) => {
    throw new Error(`unexpected warning: ${message}`);
  },
  error: () => undefined,
};

let cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
});

/** One plugin owning `notes`, before and after an upgrade. */
function plugin(name: string, version: 1 | 2, ownTable = "") {
  const notes =
    version === 1
      ? defineTable("notes", { id: col.id() })
      : defineTable(
          "notes",
          {
            id: col.id(),
            title: col.text({ nullable: true }),
            parentId: col.ref(ownTable, { nullable: true }),
          },
          {
            indexes: [{ columns: ["title"] }],
            foreignKeys: [
              {
                columns: ["parentId"],
                references: { table: ownTable, columns: ["id"] },
              },
            ],
          }
        );
  return {
    name,
    version: `${String(version)}.0.0`,
    nextly: "*",
    contributes: { schema: { tables: [notes] } },
  } as unknown as PluginDefinition;
}

async function compiled(dialect: TestDialect, definition: PluginDefinition) {
  const schema = await compileExtensionSchema({
    dialect,
    plugins: [definition],
    config: {},
    logger,
  });
  if (!schema) throw new Error("nothing compiled");
  return schema;
}

describe.each(getConfiguredTestDialects())(
  "extension tables before plugin init (%s)",
  (dialect: TestDialect) => {
    it("adds an upgrade's column, index and foreign key to the existing table", async () => {
      const adapter = await connect(dialect);
      cleanup.push(() => adapter.disconnect());
      const name = `@t${randomBytes(4).toString("hex")}/notes`;

      const v1 = await compiled(dialect, plugin(name, 1));
      const [table] = v1.specs.map(spec => spec.name);
      cleanup.push(async () => {
        await adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
      });
      expect(
        await prepareExtensionTablesBeforeInit({
          adapter,
          logger,
          extensionSchema: v1,
        })
      ).toEqual({ created: [table], altered: [] });

      const v2 = await compiled(dialect, plugin(name, 2, table));
      expect(
        await prepareExtensionTablesBeforeInit({
          adapter,
          logger,
          extensionSchema: v2,
        })
      ).toEqual({ created: [], altered: [table] });

      // What the development push would still plan afterwards. The column is
      // there on every dialect, so an `init` reading it no longer fails. The
      // index is left to the push on MySQL, which needs the column types to
      // key it, and the foreign key on SQLite, which takes one only in a
      // rebuilt CREATE TABLE.
      const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
        table,
      ]);
      expect(live.tables[0]?.columns.map(c => c.name)).toEqual(
        expect.arrayContaining(["title", "parent_id"])
      );
      const remaining = diffSnapshots(live, { tables: [...v2.specs] }).map(
        op => op.type
      );
      expect(remaining).toEqual(
        dialect === "postgresql"
          ? []
          : dialect === "mysql"
            ? ["add_index"]
            : ["add_foreign_key"]
      );
    });
  }
);
