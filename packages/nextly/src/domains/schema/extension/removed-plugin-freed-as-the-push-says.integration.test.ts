/**
 * A development push refuses removing a field that a removed plugin's index stands on, and says how
 * to free it: put the plugin back in the configuration, uninstall it with `nextly plugins
 * uninstall`, take it out of the configuration again, and apply the change. This follows those
 * steps as the sentence gives them, on every configured dialect, and the change then applies.
 *
 * The plugin's index is on a collection the app declares in code, which the app's migrations carry
 * whoever adds to it: no module of the plugin drops it. So the uninstall leaves it in place and
 * forgets that it was the plugin's, and the change takes it with the field's column, asking for the
 * data-loss consent as for any column it removes.
 *
 * The push, the uninstall and the restarts are the real ones, on one database: SQLite's file, or a
 * scratch database of the server's. Only the configuration the command reads, and the adapter it
 * opens, are the test's.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { runPluginUninstall } from "../../../cli/commands/plugin-lifecycle-runner";
import type { CommandContext } from "../../../cli/program";
import { createLogger } from "../../../cli/utils/logger";
import { defineCollection, number, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices } from "../../../di/register";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { resolveDataLossConsent } from "../migrate/data-loss-consent";
import { SchemaOwnersRepository } from "../ownership/schema-owners-repository";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import { applyDesiredSchema } from "../pipeline/index";

/** What the uninstall command reads: the configuration, and the database it opens. */
const run = vi.hoisted(() => ({
  dialect: "sqlite" as string,
  adapter: undefined as unknown as object,
  config: undefined as unknown,
}));

vi.mock("../../../cli/utils/config-loader", () => ({
  loadConfig: async () => ({
    config: run.config,
    appConfig: run.config,
    pluginConsent: undefined,
  }),
}));

vi.mock("../../../cli/utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: run.dialect,
    databaseUrl: "unused",
  }),
  // The test's adapter, kept open after the command, so the restarts boot on it.
  createCliAdapter: async () =>
    Object.assign(Object.create(run.adapter) as object, {
      disconnect: async () => {},
    }),
}));

const SLUG = "rpf_posts";
const TABLE = `dc_${SLUG}`;
const PLUGIN = "@test/rpf-indexer";
const INDEX = "idx_rpf_code";

/** The plugin: an index on the collection's own `code` column. */
const indexer = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          schema.extendTable(TABLE, {
            indexes: [{ columns: ["code"], name: INDEX }],
          });
        },
      ],
    },
  },
});

const fields = (withCode: boolean) => [
  text({ name: "title" }),
  ...(withCode ? [number({ name: "code" })] : []),
];
const posts = () => defineCollection({ slug: SLUG, fields: fields(true) });

const context = {
  logger: createLogger({ quiet: true }),
} as unknown as CommandContext;

let dir: string;
let handle: TestNextly | undefined;
let drop: (() => Promise<void>) | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-rpf-"));
});

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  await drop?.();
  drop = undefined;
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** The database every boot of a case reaches: a SQLite file, or a scratch database. */
async function databaseFor(dialect: TestDialect) {
  if (dialect === "sqlite") {
    return createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "app.db")}`,
    });
  }
  const scratch = await createScratchDatabase(dialect, "rpf");
  drop = scratch.drop;
  return createAdapter({ type: dialect, url: scratch.url });
}

describeEachDialect(
  "a removed plugin's index, freed as the push says",
  dialect => {
    /** A start on the case's database with `plugins` configured; the earlier start's services go. */
    async function boot(adapter: unknown, plugins: unknown[]) {
      clearServices();
      handle = await createTestNextly({
        adapter: adapter as never,
        plugins: plugins as never,
        collections: [posts()],
      });
    }

    /** The push of the collection with `code` or without it. */
    const push = (withCode: boolean) =>
      applyDesiredSchema(
        {
          collections: {
            [SLUG]: { slug: SLUG, tableName: TABLE, fields: fields(withCode) },
          },
          singles: {},
          components: {},
        },
        "code",
        { promptChannel: "terminal" }
      );

    async function shapeOf(adapter: TestNextly["adapter"]) {
      const table = (
        await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [TABLE])
      ).tables.find(each => each.name === TABLE);
      return {
        columns: (table?.columns ?? []).map(column => column.name),
        indexes: (table?.indexes ?? []).map(index => index.name),
        rows: (
          await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).read([
            TABLE,
          ])
        ).map(row => `${row.ownerId}:${row.elementKind}:${row.elementName}`),
      };
    }

    it("applies the change once the plugin is put back, uninstalled and taken out again", async () => {
      const adapter = (await databaseFor(dialect)) as TestNextly["adapter"];
      run.dialect = dialect;
      run.adapter = adapter as unknown as object;
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${TABLE}.code`);

      // Started with the plugin: the push makes the index and records it as the plugin's.
      await boot(adapter, [indexer]);
      const made = await shapeOf(adapter);
      expect(made.indexes).toContain(INDEX);
      expect(made.rows).toEqual([`${PLUGIN}:index:${INDEX}`]);

      // Started without it, the change is refused, and the refusal says how to free the index.
      await boot(adapter, []);
      const refused = await push(false);
      expect(refused.success).toBe(false);
      const said = refused.success ? "" : refused.error.message;
      expect(said).toContain(
        `Add "${PLUGIN}" back to the configuration, uninstall it with \`nextly plugins uninstall ${PLUGIN}\`, then remove it from the configuration and apply the change again.`
      );
      expect(await shapeOf(adapter)).toEqual(made);

      // 1. Back in the configuration. 2. Uninstalled.
      await boot(adapter, [indexer]);
      run.config = {
        db: { migrationsDir: "./migrations" },
        plugins: [indexer],
        collections: [posts()],
      };
      await runPluginUninstall(
        PLUGIN,
        {
          keepData: false,
          yes: false,
          consent: resolveDataLossConsent({ flag: true, env: {} }),
        },
        context
      );
      // The app's migrations carry the index, so no module of the plugin drops it.
      const uninstalled = await shapeOf(adapter);
      expect(uninstalled.indexes).toContain(INDEX);
      expect(uninstalled.rows).toEqual([]);

      // 3. Out of the configuration. 4. The change again.
      await boot(adapter, []);
      const applied = await push(false);

      expect(applied.success, JSON.stringify(applied)).toBe(true);
      const after = await shapeOf(adapter);
      expect(after.columns).toContain("title");
      expect(after.columns).not.toContain("code");
      expect(after.indexes).not.toContain(INDEX);
    }, 120_000);
  }
);
