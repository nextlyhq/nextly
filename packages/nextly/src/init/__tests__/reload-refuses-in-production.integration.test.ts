/**
 * The development push refuses in production before it touches anything, on every configured
 * dialect.
 *
 * A config change reaches the reload with `NODE_ENV=production`: the reload is skipped before it
 * asks for the schema lock, warns once naming `migrate:create` and `nextly migrate`, and leaves
 * the whole database (every table's columns and rows) as it was. The development push that
 * follows applies the change, so the refusal held nothing.
 *
 * Only reading the config file is replaced, as in the config-edit test: compiling it imports the
 * result through Node's loader, which Vitest's module runner cannot do.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { databaseState } from "../../cli/__tests__/helpers/database-state";
import { defineCollection, defineConfig, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { stopConfigWatch } from "../../runtime/hmr-listener";
import { reloadNextlyConfig } from "../reload-config";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

const SLUG = "rrp_notes";
const TABLE = `dc_${SLUG}`;

/** The notes collection, with the extra fields an edit adds. */
const configWith = (...extra: string[]) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [text({ name: "title" }), ...extra.map(name => text({ name }))],
      }),
    ],
  });

describe.each(getConfiguredTestDialects())(
  "a development push with NODE_ENV=production (%s)",
  dialect => {
    let handle: TestNextly;
    const adapter = () => handle.adapter as unknown as DrizzleAdapter;

    /** The column names of the notes table, as the schema pipeline reads them. */
    async function columns(): Promise<string[]> {
      const { shape } = await databaseState(adapter(), dialect);
      const tables = (
        shape as { tables: { name: string; columns: { name: string }[] }[] }
      ).tables;
      return (
        tables
          .find(table => table.name === TABLE)
          ?.columns.map(column => column.name) ?? []
      );
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      vi.stubEnv("NODE_ENV", "development");
    });

    afterEach(async () => {
      stopConfigWatch();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
      await handle?.destroy();
    });

    it("skips a config change before the lock, warns once, and changes nothing", async () => {
      // The development push first, so the database has the table and its registry row.
      loaded.config = configWith();
      await expect(reloadNextlyConfig()).resolves.toBe("finished");
      expect(await columns()).toContain("title");

      // The same edit a developer saves, reaching the reload in production.
      loaded.config = configWith("summary");
      vi.stubEnv("NODE_ENV", "production");
      const warn = vi.spyOn(handle.getService("logger"), "warn");
      const before = await databaseState(adapter(), dialect);

      await expect(reloadNextlyConfig()).resolves.toBe("refused");

      expect(await databaseState(adapter(), dialect)).toEqual(before);
      const warnings = warn.mock.calls.map(call => String(call[0]));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("`NODE_ENV` is `production`");
      expect(warnings[0]).toContain("Nothing was changed.");
      expect(warnings[0]).toContain("nextly migrate:create");
      expect(warnings[0]).toContain("run `nextly migrate` against");

      // Back in development, the push applies the edit at once: nothing was left held.
      vi.stubEnv("NODE_ENV", "development");
      await expect(reloadNextlyConfig()).resolves.toBe("finished");
      expect(await columns()).toContain("summary");
    }, 120_000);
  }
);
