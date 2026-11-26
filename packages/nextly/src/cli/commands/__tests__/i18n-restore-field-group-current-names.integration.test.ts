/**
 * `nextly i18n:restore` writes a field group's archived translations into the translations table
 * the database keeps the group under, on every configured dialect.
 *
 * A site on the current field-group names stores a group as `fg_<slug>`, with its translations in
 * `fg_<slug>_locales`. Its configuration alone would name `comp_<slug>_locales`, a table the site
 * does not have, so the restore reads the group's table from the registry.
 *
 * Each run owns its database, reached by the command through `DATABASE_URL` as an app's would: a
 * file on SQLite, a scratch database on the servers.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineConfig, defineFieldGroup, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { forgetFieldGroupStorageNames } from "../../../domains/field-groups/storage/resolve-storage-names";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runI18nRestore } from "../i18n-restore";

/** The configuration the command loads. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SILENT = createLogger({ quiet: true });

const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const hero = defineFieldGroup({
  slug: "rs_hero",
  localized: true,
  fields: [text({ name: "heading" })],
});
const CONFIG = defineConfig({
  fieldGroups: [hero],
  localization: LOCALIZATION,
});

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-restore-fg-"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  forgetFieldGroupStorageNames();
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** A database of this test's own, which the command reaches through `DATABASE_URL`. */
async function openDatabase(dialect: TestDialect): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, "app.db")}`;
  } else {
    const scratch = await createScratchDatabase(dialect, "nextly_fg_restore");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

async function connect(
  dialect: TestDialect,
  url: string
): Promise<DrizzleAdapter> {
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return adapter;
}

/** Run `fn`, turning `process.exit` into its code, and say what it printed. */
async function run(
  fn: (context: CommandContext) => Promise<void>
): Promise<{ exit: number | undefined; said: string }> {
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...SILENT,
      info: capture,
      warn: capture,
      success: capture,
      error: capture,
      keyValue: (key: string, value: string) => capture(`${key}: ${value}`),
    },
    options: {},
    cwd: dir,
  } as unknown as CommandContext;
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const printed = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(chunk => {
      said.push(String(chunk));
      return true;
    });
  try {
    await fn(context);
    return { exit: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { exit: Number(match[1]), said: said.join("\n") };
    return { exit: -1, said: [...said, String(error)].join("\n") };
  } finally {
    exit.mockRestore();
    printed.mockRestore();
    forgetFieldGroupStorageNames();
  }
}

describe.each(getConfiguredTestDialects())(
  "i18n:restore of a field group on the current names (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    it("writes the archived values into the translations table the group is stored under", async () => {
      const url = await openDatabase(dialect);
      loaded.config = CONFIG;
      // A new site keeps its field groups on the current names.
      await createTestNextly({
        adapter: (await connect(dialect, url)) as never,
        fieldGroups: [hero],
        localization: LOCALIZATION,
      });
      await shutdownServices().catch(() => {});
      clearServices();
      forgetFieldGroupStorageNames();
      const adapter = await connect(dialect, url);
      await adapter.executeQuery(
        `INSERT INTO ${q("fg_rs_hero")} (${["id", "_parent_id", "_parent_table", "_parent_field"].map(q).join(", ")}) ` +
          `VALUES ('h1', 'e1', 'dc_pages', 'hero')`
      );
      // The Spanish heading, archived when the field stopped being translated.
      await adapter.executeQuery(
        `INSERT INTO ${q("nextly_i18n_archive")} (${["collection", "entity_kind", "entry_id", "locale", "field", "value"].map(q).join(", ")}) ` +
          `VALUES ('rs_hero', 'fieldGroup', 'h1', 'es', 'heading', 'Hola')`
      );

      const restored = await run(context =>
        runI18nRestore(
          { collection: "rs_hero", kind: "field-group", cwd: dir },
          context
        )
      );

      expect(restored.exit, restored.said).toBeUndefined();
      expect(restored.said).toContain("fg_rs_hero_locales");
      const rows = await adapter.executeQuery<{ heading: string | null }>(
        `SELECT ${q("heading")} AS heading FROM ${q("fg_rs_hero_locales")} WHERE ${q("_parent")} = 'h1' AND ${q("_locale")} = 'es'`
      );
      expect(rows.map(row => row.heading)).toEqual(["Hola"]);
    });
  }
);
