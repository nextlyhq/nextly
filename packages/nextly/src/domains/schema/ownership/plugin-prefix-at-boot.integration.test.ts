/**
 * A boot refuses a plugin whose schema prefix moved since its tables were
 * recorded, before the development push creates them under the new name.
 *
 * The first boot creates `pa__ledger` and the plugin's owner row is recorded
 * as `nextly plugins install` records it. A restart with the prefix `pb` is
 * refused naming both prefixes, and the database holds no `pb__` table: the
 * refusal came before any push. The control restarts with the prefix kept.
 */
import { randomBytes } from "node:crypto";

import { afterEach, expect, it } from "vitest";

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
import { col, defineTable } from "../extension/dsl";

import { SchemaOwnersRepository } from "./schema-owners-repository";

const ledger = defineTable("ledger", { id: col.id(), title: col.shortText() });

const fixture = (prefix: string) =>
  definePlugin({
    name: "prefix-boot-fixture",
    version: "1.0.0",
    nextly: "*",
    contributes: { schema: { prefix, tables: [ledger] } },
  });

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
 * The first boot, under `pa`, on a database a restart will find: the
 * harness's own for SQLite, one created here for a server dialect. The
 * plugin's table row is then recorded, as its install's module records it.
 */
async function firstBoot(dialect: TestDialect): Promise<Adapter> {
  let adapter: Adapter;
  if (dialect === "sqlite") {
    handle = await createTestNextly({ dialect, plugins: [fixture("pa")] });
    adapter = handle.adapter;
  } else {
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
    adapter = await createAdapter({
      type: dialect,
      url: databaseUrl.toString(),
    });
    handle = await createTestNextly({ adapter, plugins: [fixture("pa")] });
  }
  expect(await adapter.tableExists("pa__ledger")).toBe(true);
  await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).upsert([
    {
      tableName: "pa__ledger",
      ownerKind: "plugin",
      ownerId: "prefix-boot-fixture",
      migratedBy: "plugin:prefix-boot-fixture",
      ownerVersion: "1.0.0",
      schemaVersion: 1,
      state: "active",
    },
  ]);
  return adapter;
}

describeEachDialect("a plugin whose schema prefix moved", dialect => {
  it("is refused at boot naming both prefixes, before any table is created under the new one", async () => {
    const adapter = await firstBoot(dialect);
    clearServices();
    // The first boot's handle stays the one torn down: it holds the adapter.
    // A refused boot disconnects the adapter it was handed, which would
    // empty an in-memory SQLite database before it could be read, so the
    // adapter is kept open across the refused boot.
    const disconnect = adapter.disconnect.bind(adapter);
    adapter.disconnect = () => Promise.resolve();
    const refused = await createTestNextly({
      adapter,
      plugins: [fixture("pb")],
    })
      .then(
        booted => {
          handle = booted;
          return "booted";
        },
        (error: unknown) => (error as { publicMessage?: string }).publicMessage
      )
      .finally(() => {
        adapter.disconnect = disconnect;
      });
    expect(refused).toMatch(
      /The plugin "prefix-boot-fixture" now has the schema prefix "pb", but its tables were created under "pa" \(pa__ledger\)/
    );
    expect(await adapter.tableExists("pb__ledger")).toBe(false);
    expect(await adapter.tableExists("pa__ledger")).toBe(true);
    // Nothing is registered after a refused boot, so tearing the first
    // handle down would leave the connection open: closed here instead.
    if (refused !== "booted") {
      await adapter.disconnect();
      handle = undefined;
    }
  });

  it("control: a restart keeping the prefix boots", async () => {
    const adapter = await firstBoot(dialect);
    clearServices();
    handle = await createTestNextly({ adapter, plugins: [fixture("pa")] });
    expect(await adapter.tableExists("pa__ledger")).toBe(true);
  });
});
