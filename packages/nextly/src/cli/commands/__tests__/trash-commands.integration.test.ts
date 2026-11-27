/**
 * `nextly trash list`, `restore` and `empty`, run as the CLI runs them: each
 * starts the application from the project's configuration on the database
 * its environment names, and stops it when done.
 *
 * - `list` names the deleted entry, its collection and when it leaves.
 * - `restore` brings it back; where its slug was taken since and no terminal
 *   can ask, it writes nothing, names the slug and the `--set` to give, and
 *   exits 1; with `--set` it restores.
 * - `empty` removes it for good, without asking, on this machine.
 *
 * @module cli/commands/__tests__/trash-commands.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * What the config file says, as `loadConfig` returns it: `appConfig` as the
 * app wrote it, and `config` with the plugins' collections already folded in.
 */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
  appConfig: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  // As the loader answers: `appConfig` as the app wrote it, which a command
  // starting the runtime boots from, and the folded `config`.
  loadConfig: async () => ({
    config: loaded.config,
    appConfig: loaded.appConfig,
    pluginConsent: NO_PLUGIN_CONSENT,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { getNextly } from "../../../init";
import { NO_PLUGIN_CONSENT } from "../../../plugins/plugin-consent";
import { definePlugin } from "../../../plugins/plugin-context";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../context";
import type { Logger } from "../../utils/logger";
import { createLogger } from "../../utils/logger";
import { runDbSync } from "../db-sync";
import {
  runTrashEmptyCommand,
  runTrashListCommand,
  runTrashRestoreCommand,
} from "../trash";

const POSTS = "clitrash_posts";
const NOTES = "clitrash_plugin_notes";

const notesCollection = defineCollection({
  slug: NOTES,
  fields: [text({ name: "title" })],
});

/**
 * A plugin contributing a collection: booting from a config that already
 * holds it would fold it a second time and refuse the slug as a duplicate.
 */
const notesPlugin = definePlugin({
  name: "clitrash-notes",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: { collections: [notesCollection] },
});

const config = defineConfig({
  plugins: [notesPlugin],
  collections: [
    defineCollection({
      slug: POSTS,
      fields: [text({ name: "title" }), text({ name: "slug", unique: true })],
    }),
  ],
});

/** A context whose logger keeps every line, by kind. */
function contextKeeping(said: string[]): CommandContext {
  const keep =
    (kind: string) =>
    (message: string): void => {
      said.push(`${kind}: ${message}`);
    };
  const logger = {
    debug: () => {},
    info: keep("info"),
    warn: keep("warn"),
    error: keep("error"),
    success: keep("success"),
    newline: () => {},
    divider: () => {},
    header: keep("header"),
    item: keep("item"),
    keyValue: () => {},
    table: (_headers: string[], rows: (string | number | boolean)[][]) => {
      for (const row of rows) said.push(`row: ${row.join(" | ")}`);
    },
    spinner: () => ({ stop: () => {} }),
    setOptions: () => {},
    getOptions: () => ({}),
  } as unknown as Logger;
  return { logger, options: {}, cwd: process.cwd() };
}

/** Run `work` on the application, then stop it, as a command does. */
async function onTheSite<T>(
  work: (nextly: Awaited<ReturnType<typeof getNextly>>) => Promise<T>
): Promise<T> {
  const nextly = await getNextly({ config } as never);
  try {
    return await work(nextly);
  } finally {
    await (nextly as unknown as { shutdown: () => Promise<void> }).shutdown();
  }
}

describeEachDialect("nextly trash list, restore and empty", dialect => {
  let dir: string;
  let drop: () => Promise<void>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-trash-cli-"));
    let url = `file:${join(dir, "test.db")}`;
    drop = async () => {};
    if (dialect !== "sqlite") {
      const scratch = await createScratchDatabase(dialect, "nextly_trash_cli");
      url = scratch.url;
      drop = scratch.drop;
    }
    vi.stubEnv("DB_DIALECT", dialect);
    vi.stubEnv("DATABASE_URL", url);
    _resetEnvCache();
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    loaded.appConfig = config;
    // As the loader folds it: the plugin's collection already among the
    // collections, which a boot must not fold a second time.
    loaded.config = {
      ...config,
      collections: [...(config.collections ?? []), notesCollection],
    };
    // The collection's table, as `nextly db:sync` makes it on a development
    // database, before the application starts on it.
    await runDbSync(
      { cwd: dir, autoSync: true } as Parameters<typeof runDbSync>[0],
      {
        logger: createLogger({ quiet: true }),
        options: {},
        cwd: dir,
      } as CommandContext
    );
  }, 120_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await drop();
    } finally {
      vi.unstubAllEnvs();
      _resetEnvCache();
      process.exitCode = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("lists, restores (asking for a taken slug through --set) and empties", async () => {
    const id = await onTheSite(async nextly => {
      const made = await nextly.create({
        collection: POSTS,
        data: { title: "From the CLI", slug: "cli" },
      });
      const madeId = String(made.item.id);
      await nextly.delete({ collection: POSTS, id: madeId });
      // Another entry takes its slug while it is in the trash.
      await nextly.create({
        collection: POSTS,
        data: { title: "Took the slug", slug: "cli" },
      });
      return madeId;
    });

    const listed: string[] = [];
    await runTrashListCommand({}, contextKeeping(listed));
    expect(listed.find(line => line.startsWith("row: "))).toContain(
      `${id} | ${POSTS} | From the CLI`
    );

    // No terminal to ask at: nothing is written, the slug is named, exit 1.
    const refused: string[] = [];
    await runTrashRestoreCommand(id, {}, contextKeeping(refused));
    expect(process.exitCode).toBe(1);
    expect(refused).toContain('warn: slug: "cli" is taken by another entry');
    expect(refused.join("\n")).toContain(`--set slug=<new value>`);
    process.exitCode = undefined;

    const restored: string[] = [];
    await runTrashRestoreCommand(
      id,
      { set: ["slug=cli-again"] },
      contextKeeping(restored)
    );
    expect(process.exitCode).toBeUndefined();
    expect(restored.some(line => line.startsWith("success: Restored"))).toBe(
      true
    );
    const back = await onTheSite(nextly =>
      nextly.findByID({ collection: POSTS, id })
    );
    expect(back).toMatchObject({ title: "From the CLI", slug: "cli-again" });

    await onTheSite(nextly => nextly.delete({ collection: POSTS, id }));
    const emptied: string[] = [];
    await runTrashEmptyCommand({}, contextKeeping(emptied));
    expect(emptied).toContain("success: Removed 1 entry for good.");
    const after: string[] = [];
    await runTrashListCommand({}, contextKeeping(after));
    expect(after).toContain("info: The trash is empty.");
  }, 120_000);
});
