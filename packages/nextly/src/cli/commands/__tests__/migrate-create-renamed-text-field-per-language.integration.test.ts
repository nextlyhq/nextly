/**
 * `nextly migrate:create` and a text field renamed in code, on the storage layout every installation
 * now runs (`perLanguageStorageSuite`): a collection that is not translated keeps its text fields'
 * values for each language in its translations table, so the rename is that table's own, offered
 * and written as a rename. Planned as an added column, the field reads empty after it: its values
 * stay in the column under the old name, which nothing reads.
 *
 * Each run owns its database, reached by the commands through `DATABASE_URL` as an app's would.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

perLanguageStorageSuite();

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SLUG = "rtl_notes";

/** The notes with a text field (kept for each language) under `name`, and one beside it. */
function notes(name: "heading" | "headline") {
  return [
    defineCollection({
      slug: SLUG,
      fields: [text({ name: "title" }), text({ name }), text({ name: "note" })],
    }),
  ];
}

const configOf = (collections: ReturnType<typeof notes>) =>
  defineConfig({
    collections,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
  });

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-renamed-text-lang-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
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
    const scratch = await createScratchDatabase(dialect, "nextly_rtl_renames");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

/** Start the app over the database at `url`, declaring `collections`. */
async function start(
  dialect: TestDialect,
  url: string,
  collections?: ReturnType<typeof notes>
): Promise<TestNextly> {
  await shutdownServices().catch(() => {});
  clearServices();
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return createTestNextly({
    adapter: adapter as never,
    ...(collections === undefined
      ? {}
      : {
          collections,
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        }),
  } as Parameters<typeof createTestNextly>[0]);
}

/** A command's context, and everything it said, its error shape on standard error included. */
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

/**
 * Run `fn` as a command: `process.exit` becomes its code, and what it prints to standard error is
 * kept with what it said.
 */
async function ran(
  said: string[],
  fn: () => Promise<void>
): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const printed = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(chunk => {
      said.push(String(chunk));
      return true;
    });
  const logged = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    said.push(String(error));
    return -1;
  } finally {
    exit.mockRestore();
    printed.mockRestore();
    logged.mockRestore();
  }
}

/**
 * `migrate:create` with `name` over `collections`, accepting each rename it offers and consenting to
 * no loss of data.
 */
async function create(
  name: string,
  collections: ReturnType<typeof notes>
): Promise<{ code: number | undefined; said: string }> {
  loaded.config = configOf(collections);
  setNonInteractive(true);
  const run = command();
  const code = await ran(run.said, () =>
    runMigrateCreate(name, { cwd: dir, acceptRenames: true }, run.context)
  );
  return { code, said: run.said.join("\n") };
}

/** `migrate`, consenting to the drops it makes; it must apply every file. */
async function applied(): Promise<void> {
  setNonInteractive(true);
  const run = command();
  expect(
    await ran(run.said, () =>
      runMigrate({ cwd: dir, acceptDataLoss: true }, run.context)
    ),
    run.said.join("\n")
  ).toBeUndefined();
}

/** The migration files written so far, by name. */
const sqlFiles = () =>
  readdirSync(join(dir, "migrations")).filter(f => f.endsWith(".sql"));

describe.each(getConfiguredTestDialects())(
  "a text field renamed in code on per-language storage (%s)",
  dialect => {
    it("renames its column in the translations table, every value kept", async () => {
      const url = await openDatabase(dialect);
      await start(dialect, url);
      const first = await create("create_notes", notes("heading"));
      expect(first.code, first.said).toBeUndefined();
      await applied();
      const app = await start(dialect, url, notes("heading"));
      const note = await app.nextly.create({
        collection: SLUG as never,
        data: { title: "N", heading: "Hello", note: "kept" } as never,
      });
      const id = String((note.item as { id: unknown }).id);

      const before = new Set(sqlFiles());
      const renamed = await create("rename_heading", notes("headline"));
      expect(renamed.code, renamed.said).toBeUndefined();
      // The rename is the translations table's, written in the file the run writes beside the main
      // one for it: every file this run wrote is read.
      const sql = sqlFiles()
        .filter(f => !before.has(f))
        .map(f => readFileSync(join(dir, "migrations", f), "utf-8"))
        .join("\n");
      expect(sql).toMatch(/RENAME COLUMN [`"]heading[`"] TO [`"]headline[`"]/);
      await applied();

      const read = (await (
        await start(dialect, url, notes("headline"))
      ).nextly.findByID({
        collection: SLUG as never,
        id: id as never,
      })) as Record<string, unknown>;
      expect(read.headline).toBe("Hello");
      expect(read.note).toBe("kept");
      expect(read.heading).toBeUndefined();
    });
  }
);
