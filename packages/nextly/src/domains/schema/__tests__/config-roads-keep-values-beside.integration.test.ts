/**
 * The roads that read configuration in code, with nobody to ask: a configuration reload under
 * `next dev`, and `nextly db:sync` where no question can be put (`CI` set, as without a terminal).
 *
 * A Builder save that would drop a translated field's values in the translations table now asks
 * for them by name before its push. These roads never drop them at all: the translations table is
 * brought in step additively, so a column it no longer needs is kept. A configuration that removes
 * a translated field is applied without losing them: the translations column keeps its values.
 * Where the field's column is on the main table too, as code-first provisioning keeps it, its drop
 * is the main table's, which `db:sync` with nobody to ask refuses, naming the consent to give.
 *
 * The reload runs on every configured dialect; `db:sync` on SQLite, through the same prepared file
 * the command's other integration tests use.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
import { defineCollection, defineConfig } from "../../../config";
import { describeError } from "../../../errors";
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
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { consoleLogger } from "../../../shared/types";

const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

/** `cfk_posts`, translated, with `teaser` and `related` unless `without` them. */
const posts = (without = false) =>
  defineCollection({
    slug: "cfk_posts",
    localized: true,
    fields: [
      { name: "heading", type: "text", localized: true },
      ...(without ? [] : [{ name: "teaser", type: "text", localized: true }]),
    ] as never,
  });
const configWith = (without = false) =>
  defineConfig({
    localization: LOCALIZATION,
    collections: [posts(without)],
  });

const columnsOf = async (
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  table: string
): Promise<string[]> =>
  (
    await adapter.executeQuery<{ name: string }>(
      dialect === "sqlite"
        ? `SELECT name FROM pragma_table_info('${table}')`
        : dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
    )
  ).map(row => String(row.name));

for (const dialect of getConfiguredTestDialects()) {
  describe(`a configuration reload removing a translated field (${dialect})`, () => {
    let t: TestNextly;

    beforeEach(async () => {
      loaded.config = configWith();
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        collections: [posts()],
        localization: LOCALIZATION,
      });
      // The reload runs its schema work only under next dev.
      vi.stubEnv("NODE_ENV", "development");
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await t?.destroy();
      vi.unstubAllEnvs();
    });

    it("applies it without a question, keeping the translated values", async () => {
      await t.nextly.create({
        collection: "cfk_posts",
        data: { heading: "Hello", teaser: "Read on" },
      } as never);
      const adapter = t.adapter as unknown as DrizzleAdapter;
      // Control: the value is stored where the reload would drop it.
      expect(
        await adapter.executeQuery(
          `SELECT teaser FROM dc_cfk_posts_locales WHERE teaser = 'Read on'`
        )
      ).toHaveLength(1);

      loaded.config = configWith(true);
      const error = vi.fn();
      await reloadNextlyConfig({
        resolver: name =>
          name === "logger"
            ? { ...consoleLogger, info: () => {}, warn: () => {}, error }
            : getService(name as Parameters<typeof getService>[0]),
      });

      // Applied: the registry row no longer holds the fields.
      expect(error.mock.calls.map(([line]) => String(line))).toEqual([]);
      const [row] = await adapter.executeQuery<{ fields: unknown }>(
        "SELECT fields FROM dynamic_collections WHERE slug = 'cfk_posts'"
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      expect(fields.map(field => field.name)).not.toContain("teaser");
      // And nothing lost: the translations column keeps what it held.
      expect(
        await adapter.executeQuery(
          `SELECT teaser FROM dc_cfk_posts_locales WHERE teaser = 'Read on'`
        )
      ).toHaveLength(1);
    }, 120_000);
  });
}

describe("db:sync with nobody to ask, removing a translated field (sqlite)", () => {
  let dir: string;
  let target: SqliteSyncTarget | undefined;
  const adapterOf = () => target!.adapter as unknown as DrizzleAdapter;

  /** `nextly db:sync` over `config`; what it threw, if anything. */
  async function dbSync(config: unknown): Promise<unknown> {
    loaded.config = config;
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
    dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-beside-"));
    vi.stubEnv("DB_DIALECT", "sqlite");
    vi.stubEnv("DATABASE_URL", `file:${join(dir, "test.db")}`);
    // No question can be put: as without a terminal.
    vi.stubEnv("CI", "true");
    _resetEnvCache();
    clearCachedSnapshot();
    target = await openSqliteSyncTarget(dir);
    expect(await dbSync(configWith())).toBeUndefined();
  });

  afterEach(async () => {
    await target?.adapter.disconnect();
    target = undefined;
    vi.unstubAllEnvs();
    _resetEnvCache();
    rmSync(dir, { recursive: true, force: true });
  });

  // The field's column the main table also keeps is a drop of the main table, which with nobody to
  // ask is refused naming the consent to give, with nothing changed. Given, it applies, and the
  // translations column is kept still.
  it("refuses the main column's drop naming the consent, and keeps the translations column once it is given", async () => {
    // Control: the column exists before.
    expect(
      await columnsOf(adapterOf(), "sqlite", "dc_cfk_posts_locales")
    ).toContain("teaser");

    const refused = await dbSync(configWith(true));

    // The command prints a failure through `describeError`, so that is what the user reads.
    expect(describeError(refused)).toContain(
      "To consent: NEXTLY_ACCEPT_DATA_LOSS=dc_cfk_posts.teaser"
    );
    expect(
      await columnsOf(adapterOf(), "sqlite", "dc_cfk_posts_locales")
    ).toContain("teaser");

    vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", "dc_cfk_posts.teaser");
    _resetEnvCache();
    expect(await dbSync(configWith(true))).toBeUndefined();

    expect(
      await columnsOf(adapterOf(), "sqlite", "dc_cfk_posts_locales")
    ).toContain("teaser");
  });
});
