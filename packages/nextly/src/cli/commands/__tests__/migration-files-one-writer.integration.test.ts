/**
 * A project's migration files have one writer at a time, so its history stays
 * one line, on every configured dialect.
 *
 * Each case runs writers together on one project directory: `nextly
 * migrate:create` driven itself (`runMigrateCreate`), and a Schema Builder
 * create of a collection through the exclusion every Builder change takes
 * (`withSchemaChangeExcluded`) and the Builder's own writer
 * (`writeCollectionSave`). What is read afterwards is what a deploy reads: the
 * `.sql` files in run order and their snapshots. Each snapshot holds the one
 * before it plus the tables its own file creates, each table is created by
 * exactly one file, and the newest snapshot holds every change.
 *
 * `migrate:create` connects to no database, so the pairs run again with its
 * `DATABASE_URL` naming one that is not there. A writer paused past its lease
 * while another writes resumes to write nothing. And a reader of the folder,
 * `nextly migrate`, run at the moment between a migration's two files, finds
 * no migration whose snapshot is missing.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  writeCollectionSave,
  type CollectionSaveDeps,
} from "../../../domains/schema/builder-save/collection-save";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  historyAsOneLine,
  snapshotTables as tablesIn,
  sqlFiles as filesIn,
} from "../../../domains/schema/migrate-create/__tests__/helpers/history-one-line";
import {
  WRITER_LOCK_FILE,
  acquireWriterHold,
  setWriterHoldBounds,
} from "../../../domains/schema/migrate-create/writer-hold";
import { withSchemaChangeExcluded } from "../../../domains/schema/services/schema-change-exclusion";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import { _resetEnvCache } from "../../../shared/lib/env";
import { toCliError } from "../../errors/from-thrown";
import { formatCliError } from "../../errors/render";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

/** The configs the commands load, in the order they are started. */
const loaded = vi.hoisted(() => ({ configs: [] as unknown[] }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.configs.shift(),
    dependencies: [],
  }),
}));

/**
 * Where a case stops a writer or looks at the folder: once a writer has read
 * the folder (`afterInputs`), and on either side of a snapshot's write, the
 * moment between a migration's two files (`aroundSnapshot`). Each is taken
 * once, by the first writer to reach it.
 */
const stops = vi.hoisted(() => ({
  afterInputs: undefined as (() => Promise<void>) | undefined,
  aroundSnapshot: undefined as (() => Promise<void>) | undefined,
}));
vi.mock(
  "../../../domains/schema/migrate-create/app-migration-inputs",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/schema/migrate-create/app-migration-inputs")
      >();
    return {
      ...original,
      appMigrationInputs: async (
        ...args: Parameters<typeof original.appMigrationInputs>
      ) => {
        const inputs = await original.appMigrationInputs(...args);
        const stop = stops.afterInputs;
        stops.afterInputs = undefined;
        await stop?.();
        return inputs;
      },
    };
  }
);
vi.mock(
  "../../../domains/schema/migrate-create/snapshot-io",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/schema/migrate-create/snapshot-io")
      >();
    return {
      ...original,
      writeSnapshot: async (
        ...args: Parameters<typeof original.writeSnapshot>
      ) => {
        const look = stops.aroundSnapshot;
        stops.aroundSnapshot = undefined;
        await look?.();
        const path = await original.writeSnapshot(...args);
        await look?.();
        return path;
      },
    };
  }
);

// This file's own tables.
const POSTS = "ow_posts";
const PAGES = "ow_pages";
const NOTES = "ow_notes";
const table = (slug: string) => `dc_${slug}`;

const collection = (slug: string) =>
  defineCollection({ slug, fields: [text({ name: "title" })] });
const configOf = (slugs: string[]) =>
  defineConfig({
    collections: slugs.map(collection),
    db: { migrationsDir: "./migrations" },
  } as Parameters<typeof defineConfig>[0]);
/** The project as it starts, and with the page collection added in code. */
const BASE = configOf([POSTS]);
const WITH_PAGES = configOf([POSTS, PAGES]);

/** The collection a Builder save creates, as the Builder's definition records it. */
const notes = {
  slug: NOTES,
  labels: { singular: "Note", plural: "Notes" },
  fields: [{ name: "title", type: "text" }],
} as UiSchemaEntity;

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let restoreBounds: () => void;
/** What the commands printed as errors: a refusal a command exits on. */
let printed: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-one-writer-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  loaded.configs.length = 0;
  // A wait long enough for the other writer of a pair to finish.
  restoreBounds = setWriterHoldBounds({ waitMs: 30_000 });
});

afterEach(async () => {
  restoreBounds();
  stops.afterInputs = undefined;
  stops.aroundSnapshot = undefined;
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A booted instance the commands reach through `DATABASE_URL`. SQLite runs on
 * a file in the test's directory, since an in-memory database is unreachable
 * from the commands' connection.
 */
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

/**
 * A `DATABASE_URL` of the same dialect naming no database that can be read:
 * a SQLite file that does not exist, or a server port nothing listens on.
 */
function unreachableUrl(dialect: TestDialect): string {
  if (dialect === "sqlite") return `file:${join(dir, "absent.db")}`;
  if (dialect === "mysql") return "mysql://nextly:nextly@127.0.0.1:1/absent";
  return "postgres://nextly:nextly@127.0.0.1:1/absent";
}

/** A command's context, with everything it says captured. */
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
        item: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** How a writer ended: with its files written, with nothing to write, or refused. */
interface Ended {
  /** The code it exited with; undefined where it returned, -1 where it threw. */
  code: number | undefined;
  said: string;
}

/** `nextly migrate:create <name> --non-interactive` over `config`. */
async function migrateCreate(config: unknown, name: string): Promise<Ended> {
  loaded.configs.push(config);
  const { context, said } = command();
  try {
    await runMigrateCreate(name, { cwd: dir }, context);
    return { code: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), said: said.join("\n") };
    said.push(formatCliError(toCliError(error)));
    return { code: -1, said: said.join("\n") };
  }
}

/** `nextly migrate --non-interactive` over `config`; whether it was refused. */
async function migrate(
  config: unknown
): Promise<{ refused: boolean; said: string }> {
  loaded.configs.push(config);
  const { context, said } = command();
  try {
    await runMigrate({ cwd: dir, throwOnFailure: true }, context);
    return { refused: false, said: said.join("\n") };
  } catch (error) {
    said.push(formatCliError(toCliError(error)));
    return { refused: true, said: said.join("\n") };
  }
}

/** The migration files written so far, in run order. */
const sqlFiles = () => filesIn(join(dir, "migrations"));
/** The tables the snapshot of `file` records. */
const snapshotTables = (file: string) =>
  tablesIn(join(dir, "migrations"), file);
/** The history as one line; the tables each file creates, in run order. */
const oneLine = () => historyAsOneLine(join(dir, "migrations"));

describe.each(getConfiguredTestDialects())(
  "a project's migration files have one writer at a time (%s)",
  dialect => {
    let adapter: DrizzleAdapter;

    beforeEach(async () => {
      setNonInteractive(true);
      vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      printed = [];
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(" "));
      });
      instance = await boot(dialect);
      adapter = instance.adapter as unknown as DrizzleAdapter;
      const created = await migrateCreate(BASE, "base");
      expect(created.code, created.said).toBeUndefined();
      const applied = await migrate(BASE);
      expect(applied.refused, applied.said).toBe(false);
      // A later file is named for a later millisecond.
      await pause(5);
    });

    afterEach(() => {
      setNonInteractive(false);
      vi.restoreAllMocks();
    });

    /** A Schema Builder create of the notes collection, as the service makes it. */
    async function builderCreate(): Promise<Ended> {
      const deps: CollectionSaveDeps = {
        adapter,
        config: WITH_PAGES,
        projectRoot: dir,
        migrationsDir: join(dir, "migrations"),
        // As outside development: the file is written and left for `nextly migrate`.
        applies: false,
        logger: quiet,
      };
      try {
        await withSchemaChangeExcluded(
          {
            adapter,
            logger: quiet as never,
            label: `create collection "${NOTES}"`,
            issuesDdl: false,
          },
          () =>
            writeCollectionSave(deps, {
              slug: NOTES,
              previous: null,
              entity: notes,
              change: "create",
            })
        );
        return { code: undefined, said: "" };
      } catch (error) {
        return {
          code: -1,
          said: (error as { publicMessage?: string }).publicMessage ?? "",
        };
      }
    }

    /** Runs `work` with `migrate:create` unable to reach a database, where asked. */
    async function reaching<T>(
      database: "reachable" | "unreachable",
      work: () => Promise<T>
    ): Promise<T> {
      if (database === "reachable") return work();
      const [url, kind] = [process.env.DATABASE_URL, process.env.DB_DIALECT];
      process.env.DATABASE_URL = unreachableUrl(dialect);
      process.env.DB_DIALECT = dialect;
      _resetEnvCache();
      try {
        return await work();
      } finally {
        if (url === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = url;
        if (kind === undefined) delete process.env.DB_DIALECT;
        else process.env.DB_DIALECT = kind;
        _resetEnvCache();
      }
    }

    describe.each(["reachable", "unreachable"] as const)(
      "with a database %s by migrate:create",
      database => {
        it("two migrate:create runs together write the change once", async () => {
          const [first, second] = await reaching(database, () =>
            Promise.all([
              migrateCreate(WITH_PAGES, "first"),
              migrateCreate(WITH_PAGES, "second"),
            ])
          );

          // One wrote the page collection; the other found nothing left to write.
          const codes = [first.code, second.code].sort();
          expect(codes, `${first.said}\n${second.said}`).toEqual([
            0,
            undefined,
          ]);
          expect(oneLine()).toEqual([[table(POSTS)], [table(PAGES)]]);
        }, 120_000);

        it("a Builder save made while migrate:create is part-way is refused at once, and each change is written once", async () => {
          // The command has read the newest snapshot and not yet written.
          let resume = () => {};
          const reached = new Promise<void>(atStop => {
            stops.afterInputs = () =>
              new Promise<void>(go => {
                resume = go;
                atStop();
              });
          });

          const { saved, created } = await reaching(database, async () => {
            const running = migrateCreate(WITH_PAGES, "pages");
            await reached;
            const save = await builderCreate();
            resume();
            return { saved: save, created: await running };
          });

          expect(created.code, created.said).toBeUndefined();
          expect(saved.code).toBe(-1);
          expect(saved.said).toMatch(/being written.*Save it again/);
          // Saved again once the command has ended.
          await pause(5);
          const again = await builderCreate();
          expect(again.code, again.said).toBeUndefined();
          expect(oneLine()).toEqual([
            [table(POSTS)],
            [table(PAGES)],
            [table(NOTES)],
          ]);
          expect(snapshotTables(sqlFiles().at(-1)!)).toEqual(
            [table(NOTES), table(PAGES), table(POSTS)].sort()
          );
        }, 120_000);

        it("migrate:create run while a Builder save is part-way waits for it, and each change is written once", async () => {
          // The save has read the newest snapshot and not yet written.
          let resume = () => {};
          const reached = new Promise<void>(atStop => {
            stops.afterInputs = () =>
              new Promise<void>(go => {
                resume = go;
                atStop();
              });
          });

          const saving = builderCreate();
          await reached;
          const creating = reaching(database, () =>
            migrateCreate(WITH_PAGES, "pages")
          );
          // The command is waiting on the folder, not writing beside the save.
          await pause(300);
          expect(sqlFiles()).toHaveLength(1);
          resume();
          const [saved, created] = await Promise.all([saving, creating]);

          expect(saved.code, saved.said).toBeUndefined();
          expect(created.code, created.said).toBeUndefined();
          expect(oneLine()).toEqual([
            [table(POSTS)],
            [table(NOTES)],
            [table(PAGES)],
          ]);
          expect(snapshotTables(sqlFiles().at(-1)!)).toEqual(
            [table(NOTES), table(PAGES), table(POSTS)].sort()
          );
        }, 120_000);

        it("a writer paused past its lease while another writes resumes to write nothing, and says so", async () => {
          restoreBounds();
          restoreBounds = setWriterHoldBounds({
            waitMs: 30_000,
            leaseSeconds: 1,
            // Never inside the case: the first writer is stopped, not renewing.
            renewMs: 600_000,
          });
          let resume = () => {};
          const reached = new Promise<void>(atStop => {
            stops.afterInputs = () =>
              new Promise<void>(go => {
                resume = go;
                atStop();
              });
          });

          const { first, second } = await reaching(database, async () => {
            const stalled = migrateCreate(WITH_PAGES, "first");
            await reached;
            // Past the first writer's lease, the second takes the folder and writes.
            await pause(1_200);
            const went = await migrateCreate(WITH_PAGES, "second");
            resume();
            return { first: await stalled, second: went };
          });

          expect(second.code, second.said).toBeUndefined();
          // It exits as a failed run, with the refusal printed.
          expect(first.code, first.said).toBe(1);
          const refusal = printed.join("\n");
          expect(refusal).toMatch(
            /`migrate:create` wrote no migration and no snapshot/
          );
          expect(refusal).toMatch(/lost its hold/);
          expect(refusal).toMatch(/Run it again/);
          expect(sqlFiles().map(f => f.replace(/^[\d_]+/, ""))).toEqual([
            "base.sql",
            "second.sql",
          ]);
          expect(oneLine()).toEqual([[table(POSTS)], [table(PAGES)]]);
        }, 120_000);
      }
    );

    it("a held folder stops migrate:create after its wait, naming the holder, and refuses a Builder save at once", async () => {
      restoreBounds();
      restoreBounds = setWriterHoldBounds({ waitMs: 400 });
      const holder = await acquireWriterHold({
        migrationsDir: join(dir, "migrations"),
        command: "migrate:baseline",
        whenHeld: "wait",
      });

      const started = Date.now();
      const saved = await builderCreate();
      const savedIn = Date.now() - started;
      const created = await migrateCreate(WITH_PAGES, "pages");

      expect(saved.code).toBe(-1);
      expect(saved.said).toMatch(/being written.*Save it again/);
      expect(savedIn).toBeLessThan(400);
      expect(created.code, created.said).toBe(-1);
      expect(created.said).toMatch(/`migrate:create` wrote nothing/);
      expect(created.said).toMatch(/`migrate:baseline` holds it/);
      // Neither wrote a file, and the Builder's definition was not kept.
      expect(sqlFiles()).toHaveLength(1);
      expect(existsSync(join(dir, "migrations", WRITER_LOCK_FILE))).toBe(true);
      await holder.release();
      expect(oneLine()).toEqual([[table(POSTS)]]);
    }, 120_000);

    it("a migration appears to nextly migrate with both its files or not at all", async () => {
      /** The files with no snapshot beside them, at a look. */
      const withoutSnapshot: string[][] = [];
      const reads: { refused: boolean; said: string }[] = [];
      stops.aroundSnapshot = async () => {
        withoutSnapshot.push(
          sqlFiles().filter(
            file =>
              !existsSync(
                join(
                  dir,
                  "migrations",
                  "meta",
                  file.replace(/\.sql$/, ".snapshot.json")
                )
              )
          )
        );
        reads.push(await migrate(WITH_PAGES));
      };

      const created = await migrateCreate(WITH_PAGES, "pages");

      expect(created.code, created.said).toBeUndefined();
      // Looked at on both sides of the snapshot's write.
      expect(withoutSnapshot).toEqual([[], []]);
      // A run in that moment applied nothing of the migration being written.
      expect(await adapter.tableExists(table(PAGES))).toBe(false);
      // And the next run applies it.
      const next = await migrate(WITH_PAGES);
      expect(next.refused, next.said).toBe(false);
      expect(await adapter.tableExists(table(PAGES))).toBe(true);
      expect(oneLine()).toEqual([[table(POSTS)], [table(PAGES)]]);
      expect(reads).toHaveLength(2);
    }, 120_000);
  }
);
