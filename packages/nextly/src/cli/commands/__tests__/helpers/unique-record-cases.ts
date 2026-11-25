/**
 * A translated unique field whose per-language index the newest snapshot does not record, on each
 * configured dialect, registered by a test file that chooses the storage layout
 * (`unique-record*.integration.test.ts`).
 *
 * Two projects hold such a snapshot and match their configuration otherwise: one adopted by
 * `migrate:baseline` after `db:sync` made its tables, and one whose newest snapshot an earlier
 * release wrote, before snapshots recorded those indexes. Neither has a change to make, so
 * `nextly migrate`, a production start's check and `migrate:check` refuse neither, and
 * `migrate:create` records the indexes once. What would separate a correct run from a broken one:
 * any surface that names the index as a change, a `migrate:create` that writes it again, or one
 * that writes nothing and leaves it unrecorded.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../../init/schema-snapshot-cache";
import { refuseUnwrittenChanges } from "../../../../domains/schema/migrate/refuse-unwritten-changes";
import { setNonInteractive } from "../../../../domains/schema/migrate/can-prompt";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestDialect } from "../../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { CliError } from "../../../errors/cli-error";
import type { CommandContext } from "../../../program";
import { createLogger } from "../../../utils/logger";
import type { LoadConfigResult } from "../../../utils/config-loader";
import { runMigrate } from "../../migrate";
import { runMigrateBaseline } from "../../migrate-baseline";
import { runMigrateCheck } from "../../migrate-check";
import { runMigrateCreate } from "../../migrate-create";
import { syncSchemaInOrder } from "../../sync-schema";

import type { Loaded } from "./pending-project";
import {
  openSyncTarget,
  throwawayDatabase,
  type SyncTarget,
} from "./sync-target";

const SLUG = "urposts";

/** What says a file beside the main migration is not recorded, and the line that names it. */
const NOT_RECORDED = "not recorded yet";
const INDEXES_LINE = `~ per-language unique indexes dc_${SLUG}`;

/** The collection's declaration: whether it, and its second field, are translated. */
interface Declared {
  localized: boolean;
  code: { localized?: boolean; unique?: boolean };
}

const projectOf = ({ localized, code }: Declared) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        ...(localized ? { localized: true } : {}),
        fields: [
          {
            name: "title",
            type: "text" as const,
            ...(localized ? { localized: true } : {}),
          },
          { name: "code", type: "text" as const, ...code },
        ],
      }),
    ],
  });

/** A translated collection with a field unique within each language. */
const project = projectOf({
  localized: true,
  code: { localized: true, unique: true },
});

/** What these cases read and change of a snapshot file. */
interface NewestSnapshot {
  entities?: unknown;
  permissions?: unknown;
  snapshot: { tables: { uniqueLocalizedColumns?: unknown }[] };
}

/** What a run said and how it ended. */
interface Ran {
  code: number | undefined;
  said: string;
}

export function uniqueRecordCases(
  loaded: Loaded,
  layout: string,
  /**
   * Whether the suite runs on per-language storage. The baseline project is tried only there: on the
   * earlier layout `db:sync` leaves the translated columns on the main table, so a baseline of it
   * differs from the configuration by those columns, whatever a snapshot records of its indexes. A
   * collection turning translation on moves its columns off the main table only on the earlier
   * layout: per-language storage keeps its text per language either way.
   */
  perLanguage: boolean
): void {
  describeEachDialect(
    `a translated unique field the newest snapshot does not record, ${layout}`,
    dialect => {
      let dir: string;
      let clock: number;
      /** Where the commands connect, and how to drop it. */
      let url: string;
      let drop: () => Promise<void> = async () => {};
      let synced: SyncTarget | undefined;
      let opened: Awaited<ReturnType<typeof createAdapter>> | undefined;
      /** What the start's check warned of. */
      let warned: string[] = [];

      beforeEach(() => {
        warned = [];
        dir = mkdtempSync(join(tmpdir(), "nextly-unique-record-"));
        mkdirSync(join(dir, "migrations"));
        clock = 0;
        // A push is skipped where the last one in the process was of the same configuration, and
        // each case has a database of its own that nothing was pushed to.
        clearCachedSnapshot();
        clearLiveSnapshots();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(Date.UTC(2026, 10, 25, 12, 0, 0, 0)));
        vi.stubEnv("CI", "");
        vi.stubEnv("DB_DIALECT", dialect);
        _resetEnvCache();
      });

      afterEach(async () => {
        vi.useRealTimers();
        await opened?.disconnect();
        opened = undefined;
        await synced?.close();
        synced = undefined;
        await drop();
        drop = async () => {};
        vi.unstubAllEnvs();
        _resetEnvCache();
        rmSync(dir, { recursive: true, force: true });
      });

      /** Point the commands at `databaseUrl`. */
      function connectTo(databaseUrl: string): void {
        url = databaseUrl;
        vi.stubEnv("DATABASE_URL", databaseUrl);
        _resetEnvCache();
      }

      async function run(
        config: unknown,
        command: (context: CommandContext) => Promise<void>
      ): Promise<Ran> {
        loaded.config = config;
        const said: string[] = [];
        const capture = (message: string) => {
          said.push(message);
        };
        const context = {
          logger: {
            ...createLogger({ quiet: true }),
            info: capture,
            warn: capture,
            success: capture,
            error: capture,
          },
          options: {},
          cwd: dir,
        } as CommandContext;
        const stderr = vi
          .spyOn(console, "error")
          .mockImplementation((...parts: unknown[]) => {
            said.push(parts.map(String).join(" "));
          });
        const exit = vi.spyOn(process, "exit").mockImplementation(code => {
          throw new Error(`exit ${String(code)}`);
        });
        try {
          await command(context);
          return { code: undefined, said: said.join("\n") };
        } catch (error) {
          const match = /^exit (\d+)$/.exec((error as Error).message);
          if (match) return { code: Number(match[1]), said: said.join("\n") };
          throw error;
        } finally {
          exit.mockRestore();
          stderr.mockRestore();
        }
      }

      const tick = () => {
        clock += 1;
        vi.setSystemTime(new Date(Date.UTC(2026, 10, 25, 12, 0, clock, 0)));
      };
      const create = (config: unknown = project) => {
        tick();
        return run(config, context => {
          // As `--non-interactive` does: no rename is asked about.
          setNonInteractive(true);
          return runMigrateCreate("change", { cwd: dir }, context).finally(() =>
            setNonInteractive(false)
          );
        });
      };
      const migrate = (config: unknown = project) => {
        tick();
        return run(config, context => runMigrate({ cwd: dir }, context));
      };
      const check = (config: unknown = project) =>
        run(config, context => runMigrateCheck({ cwd: dir }, context));
      const sqlFiles = () =>
        readdirSync(join(dir, "migrations"))
          .filter(file => file.endsWith(".sql"))
          .sort();

      /** The check a production start makes before it applies anything. */
      async function startsCheck(
        config: unknown = project
      ): Promise<string | undefined> {
        opened ??= await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0]);
        try {
          await refuseUnwrittenChanges({
            adapter: opened as unknown as DrizzleAdapter,
            config,
            projectRoot: dir,
            migrationsDir: join(dir, "migrations"),
            dialect,
            logger: {
              warn: (message: string) => warned.push(message),
              error: () => undefined,
            },
          } as Parameters<typeof refuseUnwrittenChanges>[0]);
          return undefined;
        } catch (error) {
          // The refusal's lines are in its `why`.
          return error instanceof CliError
            ? `${error.what}\n${error.why}`
            : String(error);
        }
      }

      /** A database `db:sync` made from the project, as a project developed without migrations holds. */
      async function syncTheProject(): Promise<void> {
        synced = await openSyncTarget(dir, dialect);
        if (dialect === "sqlite") connectTo(`file:${join(dir, "test.db")}`);
        else connectTo(process.env.DATABASE_URL ?? "");
        await syncSchemaInOrder(
          { config: project } as unknown as LoadConfigResult,
          synced.cli,
          { ...synced.options, cwd: dir },
          { ...synced.context, cwd: dir }
        );
      }

      /** A project whose history and database `migrate:create` and `nextly migrate` made. */
      async function migrateTheProject(
        config: unknown = project
      ): Promise<void> {
        const own =
          dialect === "sqlite"
            ? { url: `file:${join(dir, "test.db")}`, drop: async () => {} }
            : await throwawayDatabase(
                dialect as Exclude<TestDialect, "sqlite">
              );
        drop = own.drop;
        connectTo(own.url);
        const first = await create(config);
        expect(first.code, first.said).toBeUndefined();
        const applied = await migrate(config);
        expect(applied.code, applied.said).toBeUndefined();
      }

      /**
       * The newest snapshot as a release before snapshots recorded the per-language unique indexes
       * wrote it: no such record, and none of what later releases record beside it, the settings
       * and the permissions. Every snapshot that holds settings was written by a release that
       * recorded these indexes where there were any.
       */
      async function forgetTheUniques(): Promise<void> {
        await withNewestSnapshot(file => {
          const { tables } = file.snapshot;
          expect(
            tables.some(table => table.uniqueLocalizedColumns !== undefined)
          ).toBe(true);
          for (const table of tables) delete table.uniqueLocalizedColumns;
          forgetTheSettings(file);
        });
      }

      /** Nothing of what later releases record beside the tables. */
      function forgetTheSettings(file: NewestSnapshot): void {
        expect(file.entities).toBeDefined();
        delete file.entities;
        delete file.permissions;
      }

      /** The newest snapshot, changed by `change` and written back. */
      async function withNewestSnapshot(
        change: (file: NewestSnapshot) => void
      ): Promise<void> {
        const meta = join(dir, "migrations", "meta");
        const name = readdirSync(meta).sort().at(-1);
        if (name === undefined) throw new Error("no snapshot");
        const file = JSON.parse(
          await readFile(join(meta, name), "utf-8")
        ) as NewestSnapshot;
        change(file);
        await writeFile(join(meta, name), JSON.stringify(file));
      }

      const projects = [
        {
          name: "a project adopted by migrate:baseline",
          prepare: async () => {
            await syncTheProject();
            const adopted = await run(project, context =>
              runMigrateBaseline({ cwd: dir }, context)
            );
            expect(adopted.code, adopted.said).toBeUndefined();
            // The baseline adopted the tables `db:sync` made, and recorded them.
            expect(adopted.said).toContain("Adopted 1 existing tables");
          },
        },
        {
          name: "a project whose newest snapshot predates the record",
          prepare: async () => {
            await migrateTheProject();
            await forgetTheUniques();
          },
        },
      ];

      describe.each(perLanguage ? projects : projects.slice(1))(
        "$name",
        ({ prepare }) => {
          beforeEach(prepare, 120_000);

          it("is not refused by nextly migrate", async () => {
            const ran = await migrate();
            expect(ran.code, ran.said).toBeUndefined();
            expect(ran.said).toContain(NOT_RECORDED);
            expect(ran.said).toContain(INDEXES_LINE);
          });

          it("is not refused by a production start's check", async () => {
            expect(await startsCheck()).toBeUndefined();
            expect(warned.join("\n")).toContain(INDEXES_LINE);
          });

          it("passes migrate:check", async () => {
            const ran = await check();
            expect(ran.code, ran.said).toBeUndefined();
            expect(ran.said).toContain(NOT_RECORDED);
            expect(ran.said).toContain(INDEXES_LINE);
          });

          it("has the indexes recorded once by migrate:create, and nothing left after", async () => {
            const before = sqlFiles();
            const written = await create();
            expect(written.code, written.said).toBeUndefined();
            const files = sqlFiles();
            expect(files.length).toBeGreaterThan(before.length);

            const applied = await migrate();
            expect(applied.code, applied.said).toBeUndefined();
            const again = await create();
            expect(again.said).toContain("No changes detected");
            expect(sqlFiles()).toEqual(files);
            const checked = await check();
            expect(checked.code, checked.said).toBeUndefined();
            expect(checked.said).not.toContain(NOT_RECORDED);
          });
        }
      );

      // A snapshot that records no settings still records each main table, so a change there is one
      // whatever its translations files are for.
      describe("a change to the main table since a snapshot recording no settings", () => {
        const changes = [
          {
            name: "a field made translated",
            before: { localized: true, code: { localized: false } },
            after: { localized: true, code: { localized: true } },
          },
          {
            name: "a field no longer translated",
            before: { localized: true, code: { localized: true } },
            after: { localized: true, code: { localized: false } },
          },
          {
            name: "the collection made translated",
            before: { localized: false, code: {} },
            after: { localized: true, code: { localized: true } },
          },
        ];
        it.each(perLanguage ? changes.slice(0, 2) : changes)(
          "$name is refused by every surface",
          async ({ before, after }) => {
            await migrateTheProject(projectOf(before));
            await withNewestSnapshot(forgetTheSettings);
            const files = sqlFiles();
            const now = projectOf(after);
            const checked = await check(now);
            expect(checked.code, checked.said).toBe(1);
            expect(checked.said).toContain(`dc_${SLUG}`);
            expect(await startsCheck(now)).toContain(`dc_${SLUG}`);
            // Refused for that or, on per-language storage, by the step before it that would move
            // the stored translations: either way nothing is applied.
            const ran = await migrate(now);
            expect(ran.code, ran.said).toBe(1);
            expect(sqlFiles()).toEqual(files);
          },
          120_000
        );
      });
    }
  );
}
