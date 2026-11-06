/**
 * A relationship in configuration switched from one related entry to many, on the roads that read
 * configuration in code: a configuration reload under `next dev`, and `nextly db:sync`.
 *
 * On PostgreSQL and MySQL the column's type changes with the switch, and the diff converts it. On
 * SQLite the column is text either way, so the switch is read from the registry's record of the
 * field before the change; each road has to hand that record to the apply. A collection and a
 * Single each start with a row holding one id, are switched to many, and must hold that id as a
 * one-item list.
 *
 * The reload runs on every configured dialect, so the dialects are held to the same result;
 * `db:sync` on SQLite, through the prepared file the command's other integration tests use.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { runDbSync } from "../../../cli/commands/db-sync";
import {
  openSqliteSyncTarget,
  type SqliteSyncTarget,
} from "../../../cli/commands/__tests__/helpers/sqlite-sync-target";
import {
  defineCollection,
  defineConfig,
  defineSingle,
  relationship,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { getService } from "../../../di/service-access";
import { reloadNextlyConfig } from "../../../init/reload-config";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { consoleLogger } from "../../../shared/types";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

const A = "3fb954e4-f04c-4de6-b970-d16bf548688a";

const authors = defineCollection({
  slug: "authors",
  fields: [text({ name: "name" })],
});
const posts = (hasMany: boolean) =>
  defineCollection({
    slug: "posts",
    fields: [
      text({ name: "headline" }),
      relationship({ name: "author", relationTo: "authors", hasMany }),
    ],
  });
const site = (hasMany: boolean) =>
  defineSingle({
    slug: "site",
    fields: [relationship({ name: "author", relationTo: "authors", hasMany })],
  });
const config = (hasMany: boolean) =>
  defineConfig({
    collections: [authors, posts(hasMany)],
    singles: [site(hasMany)],
  });

const q = (dialect: TestDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** One row of `posts` and the Single's row, each holding the id A as one reference. */
async function rowsHoldingOneId(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<void> {
  const c = (name: string) => q(dialect, name);
  await adapter.executeQuery(
    `INSERT INTO ${c("dc_posts")} (${c("id")}, ${c("slug")}, ${c("title")}, ${c("headline")}, ${c("author")}) VALUES ('p1', 'p1', 'P1', 'P1', '${A}')`
  );
  await adapter.executeQuery(
    `INSERT INTO ${c("single_site")} (${c("id")}, ${c("title")}, ${c("slug")}, ${c("author")}) VALUES ('s1', 'Site', 'site', '${A}')`
  );
}

/** What `author` holds on the post and on the Single, read as JSON where it is JSON text. */
async function authorValues(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<{ post: unknown; single: unknown }> {
  const c = (name: string) => q(dialect, name);
  const read = async (table: string) => {
    const [row] = await adapter.executeQuery<{ author: unknown }>(
      `SELECT ${c("author")} AS ${c("author")} FROM ${c(table)}`
    );
    const value = row?.author;
    if (typeof value !== "string") return value;
    // A bare id is not JSON: answered as the text it is, so a column left unconverted reads as
    // the id rather than failing the read.
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  };
  return { post: await read("dc_posts"), single: await read("single_site") };
}

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const dir = await mkdtemp(join(tmpdir(), "nextly-hm-roads-"));
    const adapter = (await createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "test.db")}`,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return {
      adapter,
      async close() {
        await adapter.disconnect().catch(() => {});
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_hmr_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  // The reload reads the MySQL database name from here, as an app's does.
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`a relationship switched to many by a configuration reload — ${dialect}`, () => {
    let database: CaseDatabase;
    let projectRoot: string;

    /** A reload of `next`, as a saved edit triggers it; answers what it logged as errors. */
    async function reload(
      next: ReturnType<typeof defineConfig>
    ): Promise<string[]> {
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = next;
      const error = vi.fn();
      await reloadNextlyConfig({
        resolver: name =>
          name === "logger"
            ? { ...consoleLogger, info: () => {}, warn: () => {}, error }
            : getService(name as Parameters<typeof getService>[0]),
      });
      return error.mock.calls.map(([line]) => String(line));
    }

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-hm-roads-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      clearCachedSnapshot();
      database = await openDatabase(dialect);
      clearServices();
      await createTestNextly({
        adapter: database.adapter as never,
        collections: [authors, posts(false)],
      });
      // The Single arrives with a reload, as one added to the configuration under `next dev`.
      expect(await reload(config(false))).toEqual([]);
    });

    afterEach(async () => {
      clearServices();
      await database.close();
      vi.restoreAllMocks();
      await rm(projectRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    it("keeps the id each row held as a one-item list, on a collection and a Single", async () => {
      await rowsHoldingOneId(database.adapter, dialect);

      expect(await reload(config(true))).toEqual([]);

      expect(await authorValues(database.adapter, dialect)).toEqual({
        post: [A],
        single: [A],
      });
    });
  });
}

describe("a relationship switched to many by db:sync — sqlite", () => {
  let dir: string;
  let target: SqliteSyncTarget | undefined;

  const adapterOf = () => target!.adapter as unknown as DrizzleAdapter;

  /** `nextly db:sync` over `next`; what it threw, if anything. */
  async function dbSync(
    next: ReturnType<typeof defineConfig>
  ): Promise<unknown> {
    loaded.config = next;
    // The command runs in a process of its own, so nothing cached about another database's tables
    // may reach it.
    clearCachedSnapshot();
    clearLiveSnapshots();
    let thrown: unknown;
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    try {
      await runDbSync(
        { cwd: dir, autoSync: true } as Parameters<typeof runDbSync>[0],
        target!.context
      ).catch((err: unknown) => {
        thrown = err;
      });
    } finally {
      exit.mockRestore();
    }
    return thrown;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-hm-"));
    vi.stubEnv("DB_DIALECT", "sqlite");
    vi.stubEnv("DATABASE_URL", `file:${join(dir, "test.db")}`);
    _resetEnvCache();
    clearCachedSnapshot();
    target = await openSqliteSyncTarget(dir);
    expect(await dbSync(config(false))).toBeUndefined();
  });

  afterEach(async () => {
    await target?.adapter.disconnect();
    target = undefined;
    vi.unstubAllEnvs();
    _resetEnvCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the id each row held as a one-item list, on a collection and a Single", async () => {
    await rowsHoldingOneId(adapterOf(), "sqlite");

    expect(await dbSync(config(true))).toBeUndefined();

    expect(await authorValues(adapterOf(), "sqlite")).toEqual({
      post: [A],
      single: [A],
    });
  });
});
