/**
 * A translated entity's group of text and its overlay column, on each configured dialect, registered
 * by a test file that chooses the storage layout (`overlay-record*.integration.test.ts`).
 *
 * A release before overlay columns kept such a group whole on the main table, so the database it left
 * has none, and its newest snapshot records none beside the settings (`entities`) that declare the
 * group. There the column is a change still to make, whatever the settings declare: nothing but a
 * migration adds it in production, and every write of the group fails without it. A snapshot that
 * records no settings (a baseline, or one older than them) says nothing of it either way.
 *
 * What would separate a correct run from a broken one: a `migrate:create` that takes a declared group
 * for one that has its column, and writes nothing; a surface that refuses over a snapshot that never
 * said whether the column is there; or one that takes a snapshot recording settings and no column
 * for one that never said.
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
import { introspectLiveColumns } from "../../../../domains/schema/pipeline/diff/introspect-live";
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

const SLUG = "orposts";

/**
 * How the group is declared: not at all, keeping its text per language, shared whole, or translated
 * whole, as a release before overlay columns allowed.
 */
type Box = "none" | "translated" | "shared" | "whole";

/** A translated collection with one translated field, and a group of text declared as `box`. */
const projectWith = (box: Box) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text" as const, localized: true },
          ...(box === "none"
            ? []
            : [
                {
                  name: "box",
                  type: "group" as const,
                  fields: [{ name: "label", type: "text" as const }],
                  ...(box === "shared" ? { localized: false } : {}),
                  ...(box === "whole" ? { localized: true } : {}),
                },
              ]),
        ],
      }),
    ],
  });

/** What these cases read and change of a snapshot file. */
interface NewestSnapshot {
  entities?: {
    collections: Record<
      string,
      { settings: { fields: { name: string; localized?: boolean }[] } }
    >;
  };
  permissions?: unknown;
  snapshot: { tables: { name: string; localized?: boolean }[] };
}

/** What a run said and how it ended. */
interface Ran {
  code: number | undefined;
  said: string;
}

/** The line that names the overlay's file, beside the main migration. */
const OVERLAY_LINE = `~ translations table dc_${SLUG}`;

/** The line that names the group's column added to the main table. */
const MAIN_COLUMN_ADDED = new RegExp(`\\+ add_column dc_${SLUG}\\.box `);

/** What says a file beside the main migration is not recorded. */
const NOT_RECORDED = "not recorded yet";

export function overlayRecordCases(
  loaded: Loaded,
  layout: string,
  /**
   * Whether the suite runs on per-language storage. A baseline project is tried only there: on the
   * earlier layout `db:sync` leaves the translated columns on the main table, so a baseline of it
   * differs from the configuration by those columns, whatever a snapshot records of its overlays.
   */
  perLanguage: boolean
): void {
  describeEachDialect(
    `a group of text in a translated collection, ${layout}`,
    dialect => {
      let dir: string;
      let clock: number;
      let url: string;
      let drop: () => Promise<void> = async () => {};
      let synced: SyncTarget | undefined;
      let opened: Awaited<ReturnType<typeof createAdapter>> | undefined;
      /** What the last start's check warned of. */
      let warned: string[] = [];

      beforeEach(() => {
        warned = [];
        dir = mkdtempSync(join(tmpdir(), "nextly-overlay-record-"));
        mkdirSync(join(dir, "migrations"));
        clock = 0;
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
      const create = (config: unknown) => {
        tick();
        return run(config, context => {
          setNonInteractive(true);
          return runMigrateCreate("change", { cwd: dir }, context).finally(() =>
            setNonInteractive(false)
          );
        });
      };
      const migrate = (config: unknown) => {
        tick();
        // As `--backup-confirmed` does: a group stored whole per language is converted by the run.
        return run(config, context =>
          runMigrate({ cwd: dir, backupConfirmed: true }, context)
        );
      };
      const check = (config: unknown) =>
        run(config, context => runMigrateCheck({ cwd: dir }, context));
      const sqlFiles = () =>
        readdirSync(join(dir, "migrations"))
          .filter(file => file.endsWith(".sql"))
          .sort();

      /** Point the commands at `databaseUrl`. */
      function connectTo(databaseUrl: string): void {
        url = databaseUrl;
        vi.stubEnv("DATABASE_URL", databaseUrl);
        _resetEnvCache();
      }

      /** This case's database, as a start or a reader opens it. */
      async function open(): Promise<
        Awaited<ReturnType<typeof createAdapter>>
      > {
        opened ??= await createAdapter({
          type: dialect,
          url,
        } as Parameters<typeof createAdapter>[0]);
        return opened;
      }

      /** The check a production start makes before it applies anything. */
      async function startsCheck(config: unknown): Promise<string | undefined> {
        warned = [];
        try {
          await refuseUnwrittenChanges({
            adapter: (await open()) as unknown as DrizzleAdapter,
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

      /** The columns the database's translations table has. */
      async function translationColumns(): Promise<string[]> {
        const table = `dc_${SLUG}_locales`;
        const adapter = await open();
        const { tables } = await introspectLiveColumns(
          adapter.getDrizzle(),
          dialect,
          [table]
        );
        const found = tables.find(t => t.name === table);
        if (found === undefined) throw new Error("no translations table");
        return found.columns.map(column => column.name);
      }

      /** A project whose history and database `migrate:create` and `nextly migrate` made. */
      async function migrateTheProject(config: unknown): Promise<void> {
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

      /**
       * A project as a release before overlay columns left it, with the group in its settings. A
       * group shared whole is stored as that release stored one with no flag: whole on the main
       * table, with no overlay column made or recorded. The flag alone is taken off the recorded
       * settings, so they read as that release's do.
       */
      async function leftByAnEarlierRelease(): Promise<void> {
        await migrateTheProject(projectWith("shared"));
        await withNewestSnapshot(file => {
          const box = file.entities?.collections[SLUG]?.settings.fields.find(
            field => field.name === "box"
          );
          expect(box?.localized).toBe(false);
          delete box?.localized;
          const table = file.snapshot.tables.find(t => t.name === `dc_${SLUG}`);
          expect(table?.localized).toBe(true);
          expect(table).not.toHaveProperty("overlayColumns");
        });
        expect(await translationColumns()).not.toContain("box");
      }

      /** Nothing of what later releases record beside the tables. */
      async function forgetTheSettings(): Promise<void> {
        await withNewestSnapshot(file => {
          expect(file.entities).toBeDefined();
          delete file.entities;
          delete file.permissions;
        });
      }

      /** Every surface refuses, naming the overlay's file, and writes nothing. */
      async function refusedByEverySurface(config: unknown): Promise<void> {
        const files = sqlFiles();
        const checked = await check(config);
        expect(checked.code, checked.said).toBe(1);
        expect(checked.said).toContain(OVERLAY_LINE);
        const ran = await migrate(config);
        expect(ran.code, ran.said).toBe(1);
        expect(ran.said).toContain(OVERLAY_LINE);
        expect(await startsCheck(config)).toContain(OVERLAY_LINE);
        expect(sqlFiles()).toEqual(files);
      }

      /** No surface refuses, and each says the overlay is not recorded where `noticed`. */
      async function refusedByNone(
        config: unknown,
        noticed = false
      ): Promise<void> {
        const checked = await check(config);
        expect(checked.code, checked.said).toBeUndefined();
        const ran = await migrate(config);
        expect(ran.code, ran.said).toBeUndefined();
        expect(await startsCheck(config)).toBeUndefined();
        for (const said of [checked.said, ran.said, warned.join("\n")]) {
          if (noticed) {
            expect(said).toContain(NOT_RECORDED);
            expect(said).toContain(OVERLAY_LINE);
          } else {
            expect(said).not.toContain(NOT_RECORDED);
          }
        }
      }

      /** `migrate:create` writes files, `nextly migrate` applies them, and nothing is left after. */
      async function writtenAndApplied(config: unknown): Promise<void> {
        const before = sqlFiles();
        const written = await create(config);
        expect(written.code, written.said).toBeUndefined();
        const files = sqlFiles();
        expect(files.length).toBeGreaterThan(before.length);
        const applied = await migrate(config);
        expect(applied.code, applied.said).toBeUndefined();
        expect(await translationColumns()).toContain("box");
        const again = await create(config);
        expect(again.said).toContain("No changes detected");
        expect(sqlFiles()).toEqual(files);
        await refusedByNone(config);
      }

      describe("a project an earlier release left, its settings declaring the group", () => {
        const project = projectWith("translated");
        beforeEach(leftByAnEarlierRelease, 120_000);

        // The settings declare the group and the database has no column for its text.
        it("is refused by every surface, naming the overlay's file", () =>
          refusedByEverySurface(project));

        it("has the column added by migrate:create, and nothing left after", () =>
          writtenAndApplied(project));
      });

      describe("a project an earlier release left, its newest snapshot recording no settings", () => {
        const project = projectWith("translated");
        beforeEach(async () => {
          await leftByAnEarlierRelease();
          await forgetTheSettings();
        }, 120_000);

        it("is refused by no surface, which says it is not recorded", () =>
          refusedByNone(project, true));

        it("has the column added by migrate:create, and nothing left after", () =>
          writtenAndApplied(project));
      });

      describe.runIf(perLanguage)(
        "a project an earlier release's migrate:baseline adopted",
        () => {
          const project = projectWith("translated");
          beforeEach(async () => {
            // That release stored the group as this one stores a group shared whole. A baseline of
            // a database with an overlay column is refused, so this is the one a baseline leaves.
            const earlier = projectWith("shared");
            synced = await openSyncTarget(dir, dialect);
            if (dialect === "sqlite") connectTo(`file:${join(dir, "test.db")}`);
            else connectTo(process.env.DATABASE_URL ?? "");
            await syncSchemaInOrder(
              { config: earlier } as unknown as LoadConfigResult,
              synced.cli,
              { ...synced.options, cwd: dir },
              { ...synced.context, cwd: dir }
            );
            const baselined = await run(earlier, context =>
              runMigrateBaseline({ cwd: dir }, context)
            );
            expect(baselined.code, baselined.said).toBeUndefined();
            expect(baselined.said).toContain("Adopted 1 existing tables");
            expect(await translationColumns()).not.toContain("box");
          }, 120_000);

          it("is refused by no surface, which says it is not recorded", () =>
            refusedByNone(project, true));

          it("has the column added by migrate:create, and nothing left after", () =>
            writtenAndApplied(project));
        }
      );

      // Its column was on the translations table and stays there as its overlay; what is missing is
      // its structure's column on the main table, a change of that table as any other.
      describe("a group an earlier release kept translated whole, its flag taken off", () => {
        const project = projectWith("translated");
        beforeEach(async () => {
          await migrateTheProject(projectWith("whole"));
          expect(await translationColumns()).toContain("box");
        }, 120_000);

        it("is refused by every surface, naming the main table's column", async () => {
          const files = sqlFiles();
          const checked = await check(project);
          expect(checked.code, checked.said).toBe(1);
          const ran = await migrate(project);
          expect(ran.code, ran.said).toBe(1);
          const started = await startsCheck(project);
          for (const said of [checked.said, ran.said, started]) {
            expect(said).toMatch(MAIN_COLUMN_ADDED);
            expect(said).not.toContain(OVERLAY_LINE);
          }
          expect(sqlFiles()).toEqual(files);
        });

        it("has the column added by migrate:create, and nothing left after", () =>
          writtenAndApplied(project));
      });

      describe("an upgrade with nothing to make", () => {
        it.each([
          ["no group", "none"],
          ["a group shared whole", "shared"],
          ["a group whose column is recorded", "translated"],
        ] as const)(
          "with %s writes no file and is refused by no surface",
          async (_, box) => {
            const project = projectWith(box);
            await migrateTheProject(project);
            const files = sqlFiles();
            await refusedByNone(project);
            const again = await create(project);
            expect(again.said).toContain("No changes detected");
            expect(sqlFiles()).toEqual(files);
          },
          120_000
        );
      });

      describe("a group added since a snapshot that records settings and no group", () => {
        beforeEach(() => migrateTheProject(projectWith("none")), 120_000);

        it("is refused by every surface, naming the overlay's file", () =>
          refusedByEverySurface(projectWith("translated")));
      });
    }
  );
}
