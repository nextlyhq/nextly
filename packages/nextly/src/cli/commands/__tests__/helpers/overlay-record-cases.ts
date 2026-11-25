/**
 * A container of text whose overlay column the newest snapshot does not record, on each configured
 * dialect, registered by a test file that chooses the storage layout (`overlay-record*.integration.test.ts`).
 *
 * A project whose newest snapshot was written before snapshots recorded overlay columns, and which
 * matches its configuration otherwise, has no change to make: `nextly migrate`, a production start's
 * check and `migrate:check` refuse nothing, and `migrate:create` records the column once. The
 * snapshot keeps its settings (`entities`), as every release since 2026-10-28 wrote them, so the
 * absence of `entities` cannot tell such a snapshot apart. What would separate a correct run from a
 * broken one: a surface that names the overlay as a change over a snapshot that does not record it,
 * or one that takes a snapshot that records none as not recording and hides a container added since.
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
import type { CommandContext } from "../../../program";
import { createLogger } from "../../../utils/logger";
import { runMigrate } from "../../migrate";
import { runMigrateCheck } from "../../migrate-check";
import { runMigrateCreate } from "../../migrate-create";

import type { Loaded } from "./pending-project";
import { throwawayDatabase } from "./sync-target";

const SLUG = "orposts";

/** A translated collection, with a group holding text where `boxed`. */
const projectWith = (boxed: boolean) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text" as const, localized: true },
          // A group keeps one structure in every language, its text apart on its overlay column.
          ...(boxed
            ? [
                {
                  name: "box",
                  type: "group" as const,
                  fields: [{ name: "label", type: "text" as const }],
                },
              ]
            : []),
        ],
      }),
    ],
  });

interface Ran {
  code: number | undefined;
  said: string;
}

/** What names the overlay: the translations file the plan would write for it. */
const OVERLAY_LINE = `dc_${SLUG}`;

export function overlayRecordCases(loaded: Loaded, layout: string): void {
  describeEachDialect(
    `a container of text the newest snapshot does not record, ${layout}`,
    dialect => {
      let dir: string;
      let clock: number;
      let url: string;
      let drop: () => Promise<void> = async () => {};
      let opened: Awaited<ReturnType<typeof createAdapter>> | undefined;

      beforeEach(() => {
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
        return run(config, context => runMigrate({ cwd: dir }, context));
      };
      const check = (config: unknown) =>
        run(config, context => runMigrateCheck({ cwd: dir }, context));
      const sqlFiles = () =>
        readdirSync(join(dir, "migrations"))
          .filter(file => file.endsWith(".sql"))
          .sort();

      /** The check a production start makes before it applies anything. */
      async function startsCheck(config: unknown): Promise<string | undefined> {
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
            logger: { warn: () => undefined, error: () => undefined },
          } as Parameters<typeof refuseUnwrittenChanges>[0]);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
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
        url = own.url;
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        const first = await create(config);
        expect(first.code, first.said).toBeUndefined();
        const applied = await migrate(config);
        expect(applied.code, applied.said).toBeUndefined();
      }

      /**
       * The newest snapshot with its overlay record set to `record` (removed where undefined), its
       * settings kept: one a release before the record wrote, or one that records none.
       */
      async function withOverlayRecord(
        record: string[] | undefined
      ): Promise<void> {
        const meta = join(dir, "migrations", "meta");
        const name = readdirSync(meta).sort().at(-1);
        if (name === undefined) throw new Error("no snapshot");
        const file = JSON.parse(await readFile(join(meta, name), "utf-8")) as {
          entities?: unknown;
          snapshot: {
            tables: { name: string; overlayColumns?: string[] }[];
          };
        };
        // The settings stay, so no reader can tell this one apart by their absence.
        expect(file.entities).toBeDefined();
        const table = file.snapshot.tables.find(t => t.name === `dc_${SLUG}`);
        if (table === undefined) throw new Error("no table");
        if (record === undefined) delete table.overlayColumns;
        else table.overlayColumns = record;
        await writeFile(join(meta, name), JSON.stringify(file));
      }

      describe("a project with a group, whose newest snapshot predates the record", () => {
        const project = projectWith(true);
        beforeEach(async () => {
          await migrateTheProject(project);
          // Where nothing was recorded, the case would pass for the wrong reason.
          await withOverlayRecord(undefined);
        }, 120_000);

        it("is not refused by nextly migrate", async () => {
          const ran = await migrate(project);
          expect(ran.code, ran.said).toBeUndefined();
        });

        it("is not refused by a production start's check", async () => {
          expect(await startsCheck(project)).toBeUndefined();
        });

        it("passes migrate:check", async () => {
          const ran = await check(project);
          expect(ran.code, ran.said).toBeUndefined();
          expect(ran.said).not.toContain(OVERLAY_LINE);
        });
      });

      describe("a project with no container, whose newest snapshot records none", () => {
        const project = projectWith(false);
        beforeEach(async () => {
          await migrateTheProject(project);
          await withOverlayRecord([]);
        }, 120_000);

        it("is refused by nothing: the control, there is nothing to add", async () => {
          const ran = await migrate(project);
          expect(ran.code, ran.said).toBeUndefined();
          expect(await startsCheck(project)).toBeUndefined();
          expect((await check(project)).code).toBeUndefined();
        });
      });

      describe("a project whose newest snapshot records none, and a group added since", () => {
        beforeEach(async () => {
          await migrateTheProject(projectWith(false));
          await withOverlayRecord([]);
        }, 120_000);

        // A record that says none is an answer: the added group is a change, as a new field is.
        it("is refused, naming the translations file, by nextly migrate and migrate:check", async () => {
          const files = sqlFiles();
          const checked = await check(projectWith(true));
          expect(checked.code).toBe(1);
          expect(checked.said).toContain(OVERLAY_LINE);
          const ran = await migrate(projectWith(true));
          expect(ran.code).toBe(1);
          expect(ran.said).toContain(OVERLAY_LINE);
          // Refused before anything is written.
          expect(sqlFiles()).toEqual(files);
        });
      });
    }
  );
}
