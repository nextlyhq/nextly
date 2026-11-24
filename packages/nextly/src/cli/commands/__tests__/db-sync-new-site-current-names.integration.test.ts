/**
 * `nextly db:sync`, run first against an empty database, starts the site's field groups on the
 * current names, as a development start does, on every configured dialect.
 *
 * It creates the core tables itself, so it made the legacy `dynamic_components` registry and
 * `comp_<slug>` tables and recorded nothing: a new site set up by the documented sync command still
 * had the storage migration ahead of it, and a plugin's column on the group's `fg_` table was
 * refused by the compile.
 *
 * A database an earlier release set up keeps the storage it holds.
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
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { loadDialectTables } from "../../../database/dialect-tables";
import { createAdapter } from "../../../database/factory";
import { getDialectTables } from "../../../database/index";
import {
  MARKER_COLUMN,
  markerPluginOn,
} from "../../../domains/field-groups/__tests__/helpers/used-field-group-fixtures";
import {
  columnsOf,
  hasTable,
  legacyObjects,
} from "../../../domains/field-groups/__tests__/helpers/storage-generation-site";
import { runFieldGroupMigration } from "../../../domains/field-groups/migration/run";
import { readMigrationState } from "../../../domains/field-groups/migration/state";
import { forgetFieldGroupStorageNames } from "../../../domains/field-groups/storage/resolve-storage-names";
import { MetaService } from "../../../domains/meta/services/meta-service";
import { clearActiveExtensionSchema } from "../../../domains/schema/extension/active-schema";
import { freshPushSchema } from "../../../domains/schema/pipeline/fresh-push";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runDbSync, type ResolvedDevOptions } from "../db-sync";

/** The configuration the command loads. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SILENT = createLogger({ quiet: true });

const card = defineFieldGroup({
  slug: "sns_card",
  localized: true,
  fields: [text({ name: "heading" })],
});
const posts = defineCollection({
  slug: "sns_posts",
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: "sns_card" }),
  ],
});
const PROJECT = {
  collections: [posts],
  fieldGroups: [card],
  localization: { locales: ["en", "de"], defaultLocale: "en" },
};

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-sync-new-site-"));
  clearCachedSnapshot();
});

afterEach(async () => {
  clearActiveExtensionSchema();
  for (const close of closers.splice(0)) await close();
  forgetFieldGroupStorageNames();
  clearCachedSnapshot();
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
    const scratch = await createScratchDatabase(dialect, "nextly_sync_new");
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

/** `nextly db:sync`, once, with `config` as the loaded configuration. */
async function sync(config: unknown): Promise<void> {
  loaded.config = config;
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await runDbSync(
      { cwd: dir, autoSync: true } as ResolvedDevOptions,
      { logger: SILENT, options: {}, cwd: dir } as CommandContext
    );
  } finally {
    exit.mockRestore();
    forgetFieldGroupStorageNames();
  }
}

const marker = (adapter: DrizzleAdapter) =>
  readMigrationState(new MetaService(adapter, SILENT as never));

describe.each(getConfiguredTestDialects())(
  "db:sync run first against an empty database (%s)",
  dialect => {
    it("creates its registry and groups under the current names, and records it", async () => {
      const url = await openDatabase(dialect);
      await sync(defineConfig(PROJECT));

      const adapter = await connect(dialect, url);
      expect(await hasTable(adapter, "dynamic_field_groups")).toBe(true);
      expect(await columnsOf(adapter, dialect, "fg_sns_card")).toContain(
        "_field_group_type"
      );
      expect(await hasTable(adapter, "fg_sns_card_locales")).toBe(true);
      expect(await legacyObjects(adapter, dialect)).toEqual([]);

      expect(await marker(adapter)).toMatchObject({
        status: "settled",
        generation: "field-groups-v2",
        recorded: true,
      });
      const outcome = await runFieldGroupMigration({
        adapter,
        logger: SILENT as never,
        direction: "up",
        dryRun: true,
        backupConfirmed: true,
      });
      expect(outcome).toMatchObject({ ran: false, reason: "already-migrated" });
    }, 120_000);

    it("compiles a plugin's contribution to a group's table on those names", async () => {
      const url = await openDatabase(dialect);
      await sync(
        defineConfig({ ...PROJECT, plugins: [markerPluginOn("fg_sns_card")] })
      );

      const adapter = await connect(dialect, url);
      expect(await columnsOf(adapter, dialect, "fg_sns_card")).toContain(
        MARKER_COLUMN
      );
    }, 120_000);

    it("keeps them on a later sync", async () => {
      const url = await openDatabase(dialect);
      await sync(defineConfig(PROJECT));
      await sync(defineConfig(PROJECT));

      const adapter = await connect(dialect, url);
      expect(await hasTable(adapter, "dynamic_field_groups")).toBe(true);
      expect(await legacyObjects(adapter, dialect)).toEqual([]);
    }, 120_000);

    // The control: the core tables as an earlier release created them, with the legacy registry.
    it("keeps the legacy names on a database an earlier release set up", async () => {
      const url = await openDatabase(dialect);
      const adapter = await connect(dialect, url);
      await loadDialectTables(dialect);
      await freshPushSchema(
        dialect,
        adapter.getDrizzle(),
        getDialectTables(dialect)
      );
      await sync(defineConfig(PROJECT));

      expect(await hasTable(adapter, "dynamic_components")).toBe(true);
      expect(await hasTable(adapter, "comp_sns_card")).toBe(true);
      expect(await hasTable(adapter, "dynamic_field_groups")).toBe(false);
      expect(await marker(adapter)).toMatchObject({ recorded: false });
    }, 120_000);
  }
);
