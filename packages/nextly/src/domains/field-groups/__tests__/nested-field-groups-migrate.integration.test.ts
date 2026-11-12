/**
 * Field groups nested five levels deep are migrated: `migrate:create` writes the migration for the
 * configuration, `nextly migrate` applies it to an empty database, the tables it leaves are the
 * ones a start pushes for the same configuration, and a value five levels deep is written and read
 * back there.
 *
 * Each step owns its database, reached by the commands through `DATABASE_URL` as an app's would:
 * a file on SQLite, a scratch database on the servers.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import type { CommandContext } from "../../../cli/program";
import { runMigrate } from "../../../cli/commands/migrate";
import { runMigrateCreate } from "../../../cli/commands/migrate-create";
import { createLogger } from "../../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { setNonInteractive } from "../../schema/migrate/can-prompt";

/** The configuration the commands load. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const LEVELS = ["m1", "m2", "m3", "m4", "m5"] as const;

const fieldGroups = LEVELS.map((slug, i) =>
  defineFieldGroup({
    slug,
    fields: [
      text({ name: "title" }),
      ...(LEVELS[i + 1] === undefined
        ? []
        : [fieldGroup({ name: "next", component: LEVELS[i + 1] })]),
    ],
  })
);
const collections = [
  defineCollection({
    slug: "mpages",
    fields: [
      text({ name: "name" }),
      fieldGroup({ name: "top", component: "m1" }),
    ],
  }),
];
const config = defineConfig({
  collections,
  fieldGroups,
  db: { migrationsDir: "./migrations" },
});
const TABLES = [...LEVELS.map(slug => `comp_${slug}`), "dc_mpages"];

let dir: string;
let instance: TestNextly | undefined;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-nested-migrate-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  instance = undefined;
  for (const close of closers.splice(0)) await close();
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** A database of this test's own, which the commands reach through `DATABASE_URL`. */
async function openDatabase(
  dialect: TestDialect,
  name: string
): Promise<DrizzleAdapter> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, `${name}.db`)}`;
  } else {
    const scratch = await createScratchDatabase(dialect, `nextly_nm_${name}`);
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return adapter;
}

/** Start the app over `adapter`, declaring what `declare` holds. */
async function start(
  adapter: DrizzleAdapter,
  declare: {
    collections?: typeof collections;
    fieldGroups?: typeof fieldGroups;
  }
): Promise<TestNextly> {
  clearServices();
  instance = await createTestNextly({ adapter: adapter as never, ...declare });
  return instance;
}

function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...base,
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** Run `fn`, turning `process.exit` into a thrown `exit <code>`. */
async function exiting(fn: () => Promise<void>): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

/** Every column `table` has, by name, sorted. */
async function columnsOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  const sql =
    dialect === "sqlite"
      ? `SELECT name AS name FROM pragma_table_info('${table}')`
      : dialect === "postgresql"
        ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}' AND table_schema = current_schema()`
        : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}' AND table_schema = DATABASE()`;
  const rows = (await adapter.executeQuery(sql)) as Array<{
    name?: string;
    NAME?: string;
  }>;
  return rows.map(row => String(row.name ?? row.NAME)).sort();
}

async function shape(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<Record<string, string[]>> {
  const found: Record<string, string[]> = {};
  for (const table of TABLES)
    found[table] = await columnsOf(adapter, dialect, table);
  return found;
}

/** A value five levels deep, each level's title marked with its slug. */
function chain(from = 0): Record<string, unknown> {
  const value: Record<string, unknown> = { title: `v-${LEVELS[from]}` };
  if (LEVELS[from + 1] !== undefined) value.next = chain(from + 1);
  return value;
}

function titles(value: unknown): string[] {
  const found: string[] = [];
  for (let at = value as Record<string, unknown> | undefined; at; ) {
    found.push(String(at.title));
    at = at.next as Record<string, unknown> | undefined;
  }
  return found;
}

describe.each(getConfiguredTestDialects())(
  "field groups nested five deep are migrated to an empty database (%s)",
  dialect => {
    it("creates the tables a start pushes, and stores and reads every level there", async () => {
      // What a start pushes for this configuration.
      const pushed = await openDatabase(dialect, "pushed");
      await start(pushed, { collections, fieldGroups });
      const expected = await shape(pushed, dialect);
      for (const table of TABLES)
        expect(expected[table], table).not.toEqual([]);
      await shutdownServices().catch(() => {});

      // An empty database the app has started on, declaring nothing: the migration builds the rest.
      const migrated = await openDatabase(dialect, "migrated");
      await start(migrated, {});
      loaded.config = config;
      setNonInteractive(true);
      const created = command();
      expect(
        await exiting(() =>
          runMigrateCreate("nested", { cwd: dir }, created.context)
        ).finally(() => setNonInteractive(false)),
        created.said.join("\n")
      ).toBeUndefined();
      const applied = command();
      expect(
        await exiting(() => runMigrate({ cwd: dir }, applied.context)),
        applied.said.join("\n")
      ).toBeUndefined();

      expect(await shape(migrated, dialect)).toEqual(expected);

      // Started over the migrated database with the configuration, a value five deep is kept.
      const t = await start(migrated, { collections, fieldGroups });
      const entry = await t.nextly.create({
        collection: "mpages" as never,
        data: { name: "P", top: chain() } as never,
      });
      const read = (await t.nextly.findByID({
        collection: "mpages" as never,
        id: (entry.item as { id: string }).id as never,
      })) as Record<string, unknown>;
      expect(titles(read.top)).toEqual(LEVELS.map(slug => `v-${slug}`));
    });
  }
);
