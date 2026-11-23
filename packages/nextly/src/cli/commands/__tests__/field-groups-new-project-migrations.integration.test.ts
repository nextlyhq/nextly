/**
 * A new project's migration history starts on the current field-group names, and `nextly migrate`
 * sets an empty database up on the names its history keeps, on every configured dialect.
 *
 * A new project's first `nextly migrate:create` records the current names (`dynamic_field_groups`,
 * `fg_<slug>`, `_field_group_type`). Run on an empty database, `nextly migrate` creates the
 * current registry and records the storage as settled there, so `migrate:field-groups` has nothing
 * to do. A project whose history is on the legacy names still sets an empty database up on them,
 * and moves through the storage migration and the transition as an existing site does.
 *
 * Each run owns its database, reached by the commands through `DATABASE_URL` as an app's would: a
 * file on SQLite, a scratch database on the servers.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { writeLegacyFieldGroupMigration } from "../../../__tests__/helpers/legacy-field-group-history";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import type { SchemaHook } from "../../../domains/schema/extension/draft";
import { col } from "../../../domains/schema/extension/dsl";
import { shutdownServices } from "../../../di/register";
import { runFieldGroupMigration } from "../../../domains/field-groups/migration/run";
import { forgetFieldGroupStorageNames } from "../../../domains/field-groups/storage/resolve-storage-names";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

/** The configuration the commands load, set before they run. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SILENT = createLogger({ quiet: true });

const card = defineFieldGroup({
  slug: "np_card",
  fields: [text({ name: "heading" })],
});
const posts = defineCollection({
  slug: "np_posts",
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: "np_card" }),
  ],
});
const PROJECT = defineConfig({
  collections: [posts],
  fieldGroups: [card],
  db: { migrationsDir: "./migrations" },
});

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-fg-new-project-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  forgetFieldGroupStorageNames();
  vi.unstubAllEnvs();
  _resetEnvCache();
  setNonInteractive(false);
  rmSync(dir, { recursive: true, force: true });
});

/** A database of this test's own, which the commands reach through `DATABASE_URL`. */
async function openDatabase(dialect: TestDialect): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, "app.db")}`;
  } else {
    const scratch = await createScratchDatabase(
      dialect,
      "nextly_fg_new_project"
    );
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

/** Run a command, turning `process.exit` into its code, and say what it printed. */
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
    },
    options: {},
    cwd: dir,
  } as CommandContext;
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

const migrate = () => run(context => runMigrate({ cwd: dir }, context));

/** The table names the database holds. */
async function tables(adapter: DrizzleAdapter): Promise<string[]> {
  return (
    adapter as unknown as { listTables(): Promise<string[]> }
  ).listTables();
}

/** The newest snapshot's envelope, as `migrate:create` wrote it. */
async function newestSnapshot(): Promise<{
  version: number;
  fieldGroupStorage?: string;
}> {
  const meta = join(dir, "migrations", "meta");
  const newest = readdirSync(meta)
    .filter(file => file.endsWith(".snapshot.json"))
    .sort()
    .at(-1);
  if (newest === undefined) throw new Error("no snapshot");
  return JSON.parse(await readFile(join(meta, newest), "utf-8")) as {
    version: number;
    fieldGroupStorage?: string;
  };
}

/**
 * The app's own column on the card's table and an index on its type column, by the names a new
 * project's history keeps them under: what `nextly migrate` must compile on an empty database.
 */
const onCardTable: SchemaHook = ({ schema }) => {
  schema.extendTable("fg_np_card", {
    columns: { np_note: col.shortText({ nullable: true }) },
    indexes: [{ columns: ["_field_group_type"] }],
  });
};
const WITH_CARD_EXTENSION = defineConfig({
  collections: [posts],
  fieldGroups: [card],
  db: { migrationsDir: "./migrations", schema: { extend: [onCardTable] } },
});

describe.each(getConfiguredTestDialects())(
  "a new project's migrations (%s)",
  dialect => {
    it("start its history on the current names, and set an empty database up on them", async () => {
      const url = await openDatabase(dialect);
      loaded.config = PROJECT;
      setNonInteractive(true);

      const created = await run(context =>
        runMigrateCreate("init", { cwd: dir }, context)
      );
      expect(created.exit, created.said).toBeUndefined();
      expect(await newestSnapshot()).toMatchObject({
        version: 2,
        fieldGroupStorage: "current",
      });

      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();

      const adapter = await connect(dialect, url);
      const names = await tables(adapter);
      expect(names).toContain("dynamic_field_groups");
      expect(names).toContain("fg_np_card");
      expect(names).not.toContain("dynamic_components");
      expect(names).not.toContain("comp_np_card");

      // Settled on the current names: the storage migration finds nothing to do.
      const outcome = await runFieldGroupMigration({
        adapter,
        logger: SILENT as never,
        direction: "up",
        dryRun: true,
        backupConfirmed: true,
      });
      expect(outcome).toMatchObject({ ran: false, reason: "already-migrated" });
    });

    // Compiled before the run creates the registry, the app's contributions are read on the
    // names the history keeps, not on legacy names an absent registry would suggest.
    it("compile the app's contributions to a field group's table on the history's names", async () => {
      const url = await openDatabase(dialect);
      loaded.config = WITH_CARD_EXTENSION;
      setNonInteractive(true);
      const created = await run(context =>
        runMigrateCreate("init", { cwd: dir }, context)
      );
      expect(created.exit, created.said).toBeUndefined();

      const applied = await migrate();

      expect(applied.exit, applied.said).toBeUndefined();
      const adapter = await connect(dialect, url);
      const columns = (
        await adapter.executeQuery<{ name: string }>(
          dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('fg_np_card')`
            : dialect === "mysql"
              ? "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fg_np_card'"
              : "SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'fg_np_card'"
        )
      ).map(row => row.name);
      expect(columns).toContain("np_note");
    });

    // The control: a history on the legacy names sets a new database up on them.
    it("keep a legacy history's names on an empty database", async () => {
      const url = await openDatabase(dialect);
      loaded.config = PROJECT;
      await writeLegacyFieldGroupMigration({
        config: PROJECT,
        projectRoot: dir,
        migrationsDir: join(dir, "migrations"),
        dialect,
        name: "init",
      });
      expect(await newestSnapshot()).toMatchObject({ version: 1 });

      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();

      const names = await tables(await connect(dialect, url));
      expect(names).toContain("dynamic_components");
      expect(names).toContain("comp_np_card");
      expect(names).not.toContain("dynamic_field_groups");
    });
  }
);
