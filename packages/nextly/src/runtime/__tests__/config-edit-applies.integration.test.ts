/**
 * A saved schema edit reaches the database while `next dev` runs, on every
 * configured dialect.
 *
 * Everything from the save onward is real: the watcher on the config's files,
 * the debounced and serialized reload, and the schema pipeline applying DDL to
 * the database. Only reading the config file is replaced, because compiling it
 * imports the result through Node's loader, which Vitest's module runner cannot
 * do; the loader's own tests and the failure-message tests cover that half.
 *
 * Bundler and port are deliberately absent: the trigger is a file save in this
 * process, which depends on neither.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../config";
import { reloadNextlyConfig } from "../../init/reload-config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { stopConfigWatch, watchedConfigFiles } from "../hmr-listener";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
  configPath: "",
  dependencies: [] as string[],
}));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: loaded.configPath,
    dependencies: loaded.dependencies,
  }),
}));

const SLUG = "cea_notes";
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

/** Polls until `check` holds, or fails after `ms`. */
async function eventually(
  check: () => Promise<boolean>,
  ms = 20_000
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise(r => setTimeout(r, 100));
  }
}

describe.each(getConfiguredTestDialects())(
  "a schema edit saved during next dev (%s)",
  dialect => {
    let handle: TestNextly;
    let dir: string;
    let collectionFile: string;

    /** The column names the database reports for the notes table. */
    async function columns(): Promise<string[]> {
      const sql =
        dialect === "sqlite"
          ? `SELECT name AS name FROM pragma_table_info('${TABLE}')`
          : dialect === "postgresql"
            ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${TABLE}'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${TABLE}' AND table_schema = DATABASE()`;
      const rows = (await handle.adapter.executeQuery(sql)) as {
        name?: string;
        NAME?: string;
      }[];
      return rows.map(row => row.name ?? row.NAME ?? "");
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      dir = mkdtempSync(join(tmpdir(), "nextly-config-edit-"));
      mkdirSync(join(dir, "collections"));
      const configFile = join(dir, "nextly.config.ts");
      collectionFile = join(dir, "collections", "notes.ts");
      writeFileSync(
        configFile,
        'import { notes } from "./collections/notes";\n'
      );
      writeFileSync(collectionFile, "export const notes = {};\n");
      loaded.configPath = configFile;
      loaded.dependencies = [configFile, collectionFile];
      // The watcher runs only under next dev.
      vi.stubEnv("NODE_ENV", "development");
    });

    afterEach(async () => {
      stopConfigWatch();
      vi.unstubAllEnvs();
      await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
      await handle?.destroy();
      rmSync(dir, { recursive: true, force: true });
    });

    it("adds the column when a field is added to an imported collection file and saved", async () => {
      // The first read, as the dev boot does: it creates the table and starts
      // watching the config and the file it imports.
      loaded.config = configWith();
      await reloadNextlyConfig();
      expect(await columns()).toContain("title");
      expect(watchedConfigFiles().sort()).toEqual(
        [loaded.configPath, collectionFile].sort()
      );
      // Lets the watcher start before the save; see the watcher's own tests.
      await new Promise(r => setTimeout(r, 800));

      // The developer adds a field to the collection's own file and saves it.
      loaded.config = configWith("summary");
      writeFileSync(collectionFile, "export const notes = { summary: 1 };\n");

      await eventually(async () => (await columns()).includes("summary"));
    });
  }
);
