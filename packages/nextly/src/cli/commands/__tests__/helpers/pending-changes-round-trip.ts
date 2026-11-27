/**
 * One configuration edit carried through every command that reports the changes not yet in a
 * migration, on each configured dialect, registered by a test file that chooses the storage layout
 * (`pending-changes*.integration.test.ts`).
 *
 * The edit adds a number field, gives a translated field another column type and changes a
 * description:
 * a table change, a change only a file beside the main migration carries on per-language storage,
 * and a settings change. `migrate:check` and `nextly migrate` both name it, `migrate:create`
 * writes it, and then none of the three names anything and `nextly migrate` applies it. What would separate
 * a correct run from a broken one: a surface that passes over part of the edit while
 * `migrate:create` still writes it, a check, a migrate or a create that still names it once
 * written, or a migration that `nextly migrate` cannot apply.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../../config";
import { setNonInteractive } from "../../../../domains/schema/migrate/can-prompt";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import { _resetEnvCache } from "../../../../shared/lib/env";
import type { CommandContext } from "../../../program";
import { createLogger } from "../../../utils/logger";
import { runMigrate } from "../../migrate";
import { runMigrateCheck } from "../../migrate-check";
import { runMigrateCreate } from "../../migrate-create";

import type { Loaded } from "./pending-project";
import { throwawayDatabase } from "./sync-target";

const SLUG = "pcposts";

/** The project before the edit, and after it. */
const configAt = (edited: boolean) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        description: edited ? "Articles" : "Blog posts",
        fields: [
          { name: "title", type: "text" as const, localized: true },
          edited
            ? { name: "price", type: "number" as const, localized: true }
            : { name: "price", type: "text" as const, localized: true },
          // A number stays on the main table: a text-like field of a translated collection is
          // kept per language unless marked `localized: false`.
          ...(edited ? [{ name: "views", type: "number" as const }] : []),
        ],
      }),
    ],
  });

export function pendingChangesRoundTrip(loaded: Loaded, layout: string) {
  describeEachDialect(
    `the changes not yet in a migration, ${layout}`,
    dialect => {
      let dir: string;
      let drop: () => Promise<void> = async () => {};
      let clock = 0;

      beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), "nextly-pending-round-trip-"));
        mkdirSync(join(dir, "migrations"));
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(Date.UTC(2026, 10, 23, 12, 0, 0, 0)));
        // A database of the case's own: `nextly migrate` reconciles the whole database.
        const own =
          dialect === "sqlite"
            ? { url: `file:${join(dir, "test.db")}`, drop: async () => {} }
            : await throwawayDatabase(dialect);
        drop = own.drop;
        vi.stubEnv("CI", "");
        vi.stubEnv("DB_DIALECT", dialect);
        vi.stubEnv("DATABASE_URL", own.url);
        _resetEnvCache();
      });

      afterEach(async () => {
        vi.useRealTimers();
        await drop();
        vi.unstubAllEnvs();
        _resetEnvCache();
        rmSync(dir, { recursive: true, force: true });
      });

      /** Run a command over `config`: its exit code, if it exited, and all it said. */
      async function run(
        config: unknown,
        command: (context: CommandContext) => Promise<void>
      ): Promise<{ code: number | undefined; said: string }> {
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
        // A refusal ends in the CLI's error shape, on standard error.
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

      const create = (config: unknown, acceptDataLoss?: true) => {
        clock += 1;
        vi.setSystemTime(new Date(Date.UTC(2026, 10, 23, 12, 0, clock, 0)));
        return run(config, context => {
          // As `--non-interactive` does: no rename is asked about.
          setNonInteractive(true);
          return runMigrateCreate(
            "change",
            { cwd: dir, ...(acceptDataLoss ? { acceptDataLoss } : {}) },
            context
          ).finally(() => setNonInteractive(false));
        });
      };
      /** The migration files in the folder. */
      const sqlFiles = () =>
        readdirSync(join(dir, "migrations"))
          .filter(file => file.endsWith(".sql"))
          .sort();
      const check = (config: unknown) =>
        run(config, context => runMigrateCheck({ cwd: dir }, context));
      const migrate = (config: unknown, acceptDataLoss?: true) =>
        run(config, context =>
          runMigrate(
            { cwd: dir, ...(acceptDataLoss ? { acceptDataLoss } : {}) },
            context
          )
        );

      it("edits the config, migrate:check and nextly migrate report it, migrate:create captures it, and all three then report nothing", async () => {
        const before = configAt(false);
        const after = configAt(true);
        const first = await create(before);
        expect(first.code, first.said).toBeUndefined();
        const applied = await migrate(before);
        expect(applied.code, applied.said).toBeUndefined();

        // Both name the whole edit: the added column, the translated field's new type and the
        // description.
        const checked = await check(after);
        const refused = await migrate(after);
        for (const [surface, ran] of [
          ["migrate:check", checked],
          ["nextly migrate", refused],
        ] as const) {
          expect(ran.code, `${surface}: ${ran.said}`).toBe(1);
          expect(ran.said, surface).toContain(`add_column dc_${SLUG}.views`);
          expect(ran.said, surface).toMatch(
            new RegExp(
              `dc_${SLUG}(_locales)?\\.price|translations column types dc_${SLUG}`
            )
          );
          expect(ran.said, surface).toContain(`${SLUG}: description`);
        }

        // The translated field's values are converted, which needs consent to write and to apply.
        const written = await create(after, true);
        expect(written.code, written.said).toBeUndefined();
        const files = sqlFiles();

        // Nothing is left for `migrate:create` either: it says so and writes no file.
        const nothing = await create(after, true);
        expect(nothing.code, nothing.said).toBe(0);
        expect(nothing.said).toContain("No changes detected");
        expect(sqlFiles()).toEqual(files);

        const clean = await check(after);
        expect(clean.code, clean.said).toBeUndefined();
        const migrated = await migrate(after, true);
        expect(migrated.code, migrated.said).toBeUndefined();
        // Applied: nothing is left for either to name.
        const again = await migrate(after);
        expect(again.code, again.said).toBeUndefined();
        expect((await check(after)).code).toBeUndefined();
      });
    }
  );
}
