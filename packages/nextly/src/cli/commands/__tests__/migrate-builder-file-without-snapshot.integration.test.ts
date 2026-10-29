/**
 * `nextly migrate` refuses a migration file the Schema Builder wrote with no
 * snapshot beside it, before changing anything, and `migrate:check` fails on
 * the same file — on every configured dialect.
 *
 * The file is the Builder's own: `DynamicCollectionService.generateCollection`
 * plans a create and `CollectionFileManager.saveMigration` writes it, the two
 * steps a Builder create takes on a project, so its name and contents are the
 * ones a real save leaves. No snapshot is written beside it, as none is today.
 *
 * The control is a hand-written file with no snapshot, which `nextly migrate`
 * still applies as written: what is refused is a Builder file, not every file
 * without a snapshot.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { defineConfig } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { loadedDialect } from "../../../database/dialect-tables";
import { DynamicCollectionService } from "../../../domains/dynamic-collections/services/dynamic-collection-service";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CollectionFileManager } from "../../../services/collection-file-manager";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCheck } from "../migrate-check";

/** The config the commands load. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-builder-file-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  loaded.config = defineConfig({
    collections: [],
    db: { migrationsDir: "./migrations" },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** A booted instance the commands reach through `DATABASE_URL`. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  if (dialect !== "sqlite") return createTestNextly({ dialect });
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter });
}

const quiet = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Write the migration a Builder create of `slug` writes, as the Builder writes it. */
async function builderCreates(t: TestNextly, slug: string): Promise<string> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const artifacts = (await new DynamicCollectionService(
    adapter,
    quiet
  ).generateCollection({
    name: slug,
    fields: [{ name: "title", type: "text" }],
  } as never)) as unknown as {
    migrationSQL: string;
    migrationFileName: string;
  };
  await new CollectionFileManager(adapter.getDrizzle() as never, {
    schemasDir: join(dir, "schemas"),
    migrationsDir: join(dir, "migrations"),
  }).saveMigration(artifacts.migrationSQL, artifacts.migrationFileName);
  return artifacts.migrationFileName;
}

/** A command's context, with everything it says captured. */
function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  // The error a command ends with is printed on standard error, in the error shape.
  vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
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

/** Run `fn`, turning `process.exit` into the code it was called with. */
async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
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

type Rows = Record<string, unknown>[];
interface Selecting {
  select: () => { from: (table: unknown) => Promise<Rows> };
}

/** Everything the refusal must leave as it was: tables, ledger, registry. */
async function state(t: TestNextly, dialect: TestDialect) {
  const adapter = t.adapter as unknown as DrizzleAdapter & {
    listTables: () => Promise<string[]>;
  };
  const db = adapter.getDrizzle<Selecting>();
  const { tables } = loadedDialect(dialect);
  const byId = (rows: Rows) =>
    [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    tables: [...(await adapter.listTables())].sort(),
    ledger: byId(await db.select().from(tables.nextlySchemaEvents)),
    collections: byId(await db.select().from(tables.dynamicCollections)),
  };
}

describe.each(getConfiguredTestDialects())(
  "a Builder-written migration with no snapshot (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
    });

    it("nextly migrate refuses it, naming it, and changes nothing", async () => {
      const t = instance!;
      const file = await builderCreates(t, "bf_events");
      const before = await state(t, dialect);

      const { context, said } = command();
      const code = await exitCode(() => runMigrate({ cwd: dir }, context));

      expect(code).toBe(1);
      // Nothing changed: no table, no ledger row, no registry row.
      expect(await state(t, dialect)).toEqual(before);
      const refusal = said.filter(line => line.includes(file));
      expect(refusal, said.join("\n")).toEqual([
        expect.stringMatching(/Schema Builder.*no snapshot/s),
      ]);
      expect(refusal[0]).toContain("migrate:create");
      expect(before.tables).not.toContain("dc_bf_events");
    });

    it("migrate:check fails on it, naming it", async () => {
      const t = instance!;
      const file = await builderCreates(t, "bf_events");

      const { context, said } = command();
      const code = await exitCode(() => runMigrateCheck({ cwd: dir }, context));

      expect(code).toBe(1);
      // Named as the Builder's, with the remedy for one: the generic advice for
      // a file with no snapshot is to delete it or copy it into a blank one.
      expect(said.filter(line => line.includes(file))).toEqual([
        expect.stringMatching(/Schema Builder.*`nextly migrate:create`/s),
      ]);
    });

    it("a hand-written file with no snapshot still applies as written", async () => {
      const t = instance!;
      const file = "20261028_120000_000_hand_written.sql";
      const q = dialect === "mysql" ? "`" : '"';
      writeFileSync(
        join(dir, "migrations", file),
        `-- Migration: hand_written\n\n-- UP\nCREATE TABLE ${q}bf_hand${q} (${q}id${q} varchar(36) PRIMARY KEY);\n\n-- DOWN\nDROP TABLE ${q}bf_hand${q};\n`
      );
      expect(readdirSync(join(dir, "migrations"))).toEqual([file]);

      const { context, said } = command();
      const code = await exitCode(() => runMigrate({ cwd: dir }, context));

      expect(code, said.join("\n")).toBeUndefined();
      const adapter = t.adapter as unknown as DrizzleAdapter;
      expect(
        await new SchemaEventsRepository(
          adapter.getDrizzle(),
          dialect
        ).isFileApplied(file)
      ).toBe(true);
    });
  }
);
