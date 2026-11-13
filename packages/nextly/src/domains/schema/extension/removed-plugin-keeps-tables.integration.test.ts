/**
 * A plugin removed from the configuration keeps its tables and their rows,
 * across a restart and a push, on every configured dialect.
 *
 * The boot is the code under test, so the same database is booted twice:
 * with the plugin, then without it. On PostgreSQL and MySQL the database is
 * created here rather than by the harness, because the harness drops the
 * database it provisioned when the next instance boots. SQLite's in-memory
 * database survives the restart on the adapter it is handed.
 */
import { randomBytes } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { applyDesiredSchema } from "../pipeline/index";

import { getActiveExtensionSchema } from "./build-extension-schema";
import { col, defineTable } from "./dsl";

const ledger = defineTable("ledger", {
  id: col.id(),
  title: col.shortText(),
});

const fixture = definePlugin({
  name: "removed-plugin-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "rp", tables: [ledger] } },
});

const host = defineCollection({
  slug: "rp_host_posts",
  fields: [text({ name: "headline" })],
});

const ROW = "018f2c2e-0000-7000-8000-00000000a001";

let handle: TestNextly | undefined;
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  await cleanup?.();
  cleanup = undefined;
});

type Adapter = TestNextly["adapter"];

/**
 * The first boot, with the plugin, on a database the restart will find: the
 * harness's own for SQLite, one created here for a server dialect.
 */
async function firstBoot(dialect: TestDialect): Promise<Adapter> {
  if (dialect === "sqlite") {
    handle = await createTestNextly({
      dialect,
      plugins: [fixture],
      collections: [host],
    });
    return handle.adapter;
  }
  const serverUrl =
    process.env[
      dialect === "postgresql" ? "TEST_POSTGRES_URL" : "TEST_MYSQL_URL"
    ];
  if (serverUrl === undefined) throw new Error(`no URL for ${dialect}`);
  const server = await createAdapter({ type: dialect, url: serverUrl });
  const name = `nextly_t_${randomBytes(12).toString("hex")}`;
  const databaseUrl = new URL(serverUrl);
  databaseUrl.pathname = `/${name}`;
  const previousUrl = process.env.DATABASE_URL;
  const previousDialect = process.env.DB_DIALECT;
  await server.executeQuery(createDatabaseStatement(dialect, name));
  cleanup = async () => {
    await server.executeQuery(dropDatabaseStatement(dialect, name));
    await server.disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
    _resetEnvCache();
  };
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.DB_DIALECT = dialect;
  _resetEnvCache();
  const adapter = await createAdapter({
    type: dialect,
    url: databaseUrl.toString(),
  });
  handle = await createTestNextly({
    adapter,
    plugins: [fixture],
    collections: [host],
  });
  return adapter;
}

describeEachDialect("a plugin removed from the configuration", dialect => {
  it("keeps its table and its rows across a restart and a push", async () => {
    const adapter = await firstBoot(dialect);
    await adapter.executeQuery(
      `INSERT INTO rp__ledger (id, title) VALUES ('${ROW}', 'stays')`
    );

    // Restart on the same database with the plugin gone from the config.
    clearServices();
    handle = await createTestNextly({
      adapter,
      plugins: [],
      collections: [host],
    });
    // The premise: nothing declares the plugin's table any more.
    expect(getActiveExtensionSchema(dialect)).toBeNull();

    // A push of the configuration as it now stands.
    const pushed = await applyDesiredSchema(
      {
        collections: {
          rp_host_posts: {
            slug: "rp_host_posts",
            tableName: "dc_rp_host_posts",
            fields: host.fields,
          },
        },
        singles: {},
        components: {},
      },
      "code",
      { promptChannel: "terminal" }
    );
    expect(pushed.success, JSON.stringify(pushed)).toBe(true);

    expect(await adapter.tableExists("rp__ledger")).toBe(true);
    const rows = await adapter.executeQuery<{ title: string }>(
      `SELECT title FROM rp__ledger WHERE id = '${ROW}'`
    );
    expect(rows.map(row => row.title)).toEqual(["stays"]);
  });
});
