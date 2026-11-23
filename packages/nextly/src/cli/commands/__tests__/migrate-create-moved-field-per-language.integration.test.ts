/**
 * `nextly migrate:create` and a field moved into a group on the storage layout every installation
 * now runs: translatable values kept for each language, in the entity's language table
 * (`perLanguageStorageSuite`).
 *
 * A field kept for each language (a `text` field, unless it says `localized: false`) cannot be
 * moved with its values yet: the run refuses the move before it writes anything, naming the field
 * and what it can do instead (decline the move). A field kept once for every language (a `number`)
 * moves as it does on the earlier layout, its values carried into the group.
 *
 * Each run owns its database, reached by the commands through `DATABASE_URL` as an app's would.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineConfig,
  group,
  number,
  text,
} from "../../../config";
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

const SLUG = "mfl_posts";

/** The posts with `subtitle` (kept for each language) and `views` (kept once) on the row or in `meta`. */
function posts(where: "row" | "grouped") {
  const moved = [text({ name: "subtitle" }), number({ name: "views" })];
  return [
    defineCollection({
      slug: SLUG,
      fields: [
        text({ name: "title" }),
        ...(where === "row" ? moved : []),
        group({
          name: "meta",
          fields: [
            text({ name: "note" }),
            ...(where === "grouped" ? moved : []),
          ],
        }),
      ],
    }),
  ];
}

/** The posts with only `views` moved into `meta`, `subtitle` left on the row. */
function viewsGrouped() {
  return [
    defineCollection({
      slug: SLUG,
      fields: [
        text({ name: "title" }),
        text({ name: "subtitle" }),
        group({
          name: "meta",
          fields: [text({ name: "note" }), number({ name: "views" })],
        }),
      ],
    }),
  ];
}

const configOf = (collections: ReturnType<typeof posts>) =>
  defineConfig({
    collections,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
  });

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-moved-field-lang-"));
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
    const scratch = await createScratchDatabase(dialect, "nextly_mfl_moves");
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
  collections?: ReturnType<typeof posts>
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

/** `migrate:create` with `name` over `collections`, accepting every move and drop; how it ended. */
async function create(
  name: string,
  collections: ReturnType<typeof posts>
): Promise<{ code: number | undefined; said: string }> {
  loaded.config = configOf(collections);
  setNonInteractive(true);
  const run = command();
  const code = await ran(run.said, () =>
    runMigrateCreate(
      name,
      { cwd: dir, acceptDataLoss: true, acceptMoves: true },
      run.context
    )
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

/** Whether `migrate:create` wrote a migration named `name`. */
const written = (name: string) =>
  readdirSync(join(dir, "migrations")).some(f => f.endsWith(`_${name}.sql`));

describe.each(getConfiguredTestDialects())(
  "a field moved into a group on per-language storage (%s)",
  dialect => {
    it("refuses moving a field kept for each language, naming it and what to do instead", async () => {
      const url = await openDatabase(dialect);
      await start(dialect, url);
      const first = await create("create_posts", posts("row"));
      expect(first.code, first.said).toBeUndefined();
      await applied();

      const refused = await create("move_in", posts("grouped"));
      expect(refused.code, refused.said).not.toBeUndefined();
      expect(refused.said).toMatch(/subtitle/);
      expect(refused.said).toMatch(/not available yet/);
      expect(refused.said).toMatch(
        /answer no when nextly migrate:create asks, or leave out --accept-moves/
      );
      expect(written("move_in")).toBe(false);
    });

    it("moves a field kept once for every language, as on the earlier layout", async () => {
      const url = await openDatabase(dialect);
      await start(dialect, url);
      const first = await create("create_posts", posts("row"));
      expect(first.code, first.said).toBeUndefined();
      await applied();
      const app = await start(dialect, url, posts("row"));
      const post = await app.nextly.create({
        collection: SLUG as never,
        data: {
          title: "P",
          subtitle: "S",
          views: 7,
          meta: { note: "N" },
        } as never,
      });
      const id = String((post.item as { id: unknown }).id);

      const moved = await create("move_views_in", viewsGrouped());
      expect(moved.code, moved.said).toBeUndefined();
      await applied();

      const read = (await (
        await start(dialect, url, viewsGrouped())
      ).nextly.findByID({
        collection: SLUG as never,
        id: id as never,
      })) as Record<string, unknown>;
      expect((read.meta as { views?: unknown } | null)?.views).toBe(7);
      expect(read.views).toBeUndefined();
    });
  }
);
