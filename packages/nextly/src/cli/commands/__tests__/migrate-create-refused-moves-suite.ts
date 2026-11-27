/**
 * A field the database keeps unique, moved into a group or a repeater in code, as `migrate:create`
 * refuses it: before anything is written, naming the container and why, and the same on every
 * configured dialect. Run from one file per storage layout, which sets the loaded configuration's
 * mock, as `vi.mock` is each file's own.
 *
 * Each run owns its database, reached by the commands through `DATABASE_URL` as an app's would: a
 * file on SQLite, a scratch database on the servers.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { MIGRATION_TARGET } from "../../../domains/field-groups/migration/target";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { databaseState } from "../../../domains/schema/field-moves/__tests__/refused-moves-state";
import {
  configOf,
  definitions,
  ENTITY_KINDS,
  FRAME,
  INSIDE_REPEATER_MOVES,
  HOME,
  PEOPLE,
  POSTS,
  refusalMessage,
  seed,
  TABLE_PREFIXES,
  TARGETS,
  UNIQUE_KINDS,
  type EntityKind,
  type UniqueKind,
} from "../../../domains/schema/field-moves/__tests__/refused-code-moves";
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

/** The configuration the commands load, set by each step; the calling file mocks the loader. */
export function describeRefusedCodeMoves(loaded: { config: unknown }): void {
  describe.each(getConfiguredTestDialects())(
    "migrate:create refuses a field kept unique into a group or a repeater (%s)",
    (dialect: TestDialect) => {
      let dir: string;
      let closers: Array<() => Promise<void>> = [];

      beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "nextly-refused-code-"));
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
      async function openDatabase(): Promise<string> {
        let url: string;
        if (dialect === "sqlite") {
          url = `file:${join(dir, "app.db")}`;
        } else {
          const scratch = await createScratchDatabase(dialect, "nextly_rcm");
          url = scratch.url;
          closers.push(() => scratch.drop());
        }
        vi.stubEnv("DB_DIALECT", dialect);
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        return url;
      }

      /** The app over the database at `url`, declaring `kind`'s field on the row, or no entity yet. */
      async function start(
        url: string,
        entity?: EntityKind,
        kind?: UniqueKind
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
          localization: { locales: ["en", "es"], defaultLocale: "en" },
          ...(entity === undefined || kind === undefined
            ? {}
            : definitions(entity, kind, null)),
        });
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

      /** Run `fn`, turning `process.exit` into a thrown `exit <code>`, its printing captured. */
      async function exiting(
        said: string[],
        fn: () => Promise<void>
      ): Promise<number | undefined> {
        const exit = vi.spyOn(process, "exit").mockImplementation(code => {
          throw new Error(`exit ${String(code)}`);
        });
        // A failed run prints its error shape to standard error, not through the logger.
        const printed = vi
          .spyOn(process.stderr, "write")
          .mockImplementation(chunk => {
            said.push(String(chunk));
            return true;
          });
        const logged = vi
          .spyOn(console, "error")
          .mockImplementation(message => {
            said.push(String(message));
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
          printed.mockRestore();
          logged.mockRestore();
        }
      }

      /** The database, registry and migrations folder, which a refused run leaves as they were. */
      const state = (t: TestNextly) =>
        databaseState({
          run: <T>(statement: string) =>
            (t.adapter as unknown as DrizzleAdapter).executeQuery(
              statement
            ) as unknown as Promise<T[]>,
          dialect,
          tablePrefixes: TABLE_PREFIXES,
          registries: [
            { table: "dynamic_collections", slugs: [PEOPLE, POSTS] },
            { table: "dynamic_singles", slugs: [HOME] },
            { table: MIGRATION_TARGET.registryTable, slugs: [FRAME] },
          ],
          migrations: join(dir, "migrations"),
        });

      it.each(
        ENTITY_KINDS.flatMap(entity =>
          UNIQUE_KINDS.map(kind => ({ entity, kind }))
        )
      )(
        "$entity: $kind.kind, at one depth, two and three: nothing written, nothing changed",
        async ({ entity, kind }) => {
          const url = await openDatabase();
          setNonInteractive(true);
          await start(url);

          // The entity, its field on the row, created by a first migration as the Builder would.
          loaded.config = configOf(entity, kind, null);
          const created = command();
          expect(
            await exiting(created.said, () =>
              runMigrateCreate(
                "create_entity",
                { cwd: dir, acceptDataLoss: true },
                created.context
              )
            ),
            created.said.join("\n")
          ).toBeUndefined();
          const applied = command();
          expect(
            await exiting(applied.said, () =>
              runMigrate({ cwd: dir, acceptDataLoss: true }, applied.context)
            ),
            applied.said.join("\n")
          ).toBeUndefined();

          const t = await start(url, entity, kind);
          await seed(t, entity, kind);
          const before = await state(t);

          for (const target of TARGETS) {
            loaded.config = configOf(entity, kind, target.path);
            const run = command();
            const code = await exiting(run.said, () =>
              runMigrateCreate(
                `move_${target.path.join("_")}`,
                { cwd: dir, acceptDataLoss: true, acceptMoves: true },
                run.context
              )
            );
            const said = run.said.join("\n");
            expect(code, said).toBe(1);
            expect(said, target.what).toContain(
              refusalMessage(kind.name, target)
            );
            expect(await state(t), target.what).toEqual(before);
          }
        }
      );

      it.each(ENTITY_KINDS)(
        "%s: a unique field already inside a repeater, moved out of it or within it: nothing written, nothing changed",
        async entity => {
          const kind = UNIQUE_KINDS[0];
          if (kind === undefined) throw new Error("no unique kind");
          const url = await openDatabase();
          setNonInteractive(true);
          await start(url);
          loaded.config = configOf(entity, kind, ["items"]);
          const created = command();
          expect(
            await exiting(created.said, () =>
              runMigrateCreate(
                "create_entity",
                { cwd: dir, acceptDataLoss: true },
                created.context
              )
            ),
            created.said.join("\n")
          ).toBeUndefined();
          const applied = command();
          expect(
            await exiting(applied.said, () =>
              runMigrate({ cwd: dir, acceptDataLoss: true }, applied.context)
            ),
            applied.said.join("\n")
          ).toBeUndefined();
          const t = await start(url);
          const before = await state(t);

          for (const { what, path, message } of INSIDE_REPEATER_MOVES) {
            loaded.config = configOf(entity, kind, path);
            const run = command();
            const code = await exiting(run.said, () =>
              runMigrateCreate(
                `move_${(path ?? ["row"]).join("_")}`,
                { cwd: dir, acceptDataLoss: true, acceptMoves: true },
                run.context
              )
            );
            const said = run.said.join("\n");
            expect(code, `${what}: ${said}`).toBe(1);
            expect(said, what).toContain(message);
            expect(await state(t), what).toEqual(before);
          }
        }
      );
    }
  );
}
