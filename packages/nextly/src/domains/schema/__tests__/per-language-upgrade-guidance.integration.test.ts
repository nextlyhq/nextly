/**
 * The upgrade of a site whose migrations were written before every installation kept its
 * text-like fields per language, and whose config declares no `localization` block.
 *
 * The app is migrated as an earlier release laid it out (the test-only
 * `setPerLanguageStorage(false)`): `nextly migrate:create` writes its first migration, with every
 * text column on the main table, and `nextly migrate` applies it. Then the same app runs on this
 * release. Each command that meets the move says what it is, not data loss:
 *
 * - `nextly migrate` stops with SCHEMA_DRIFT;
 * - `nextly migrate:check` fails with SCHEMA_DRIFT;
 * - `nextly migrate:create` refuses with INPUT_REFUSED.
 *
 * Each names the fields that would move, the per-language table they would move to, that nothing
 * is lost, and the two safe ways forward: `localized: false` on the fields, or a `localization`
 * block declared on purpose. The first way is then walked: with the fields marked, `nextly
 * migrate:create` records the settings change in a migration that moves nothing, and `nextly
 * migrate` and `nextly migrate:check` pass.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrate } from "../../../cli/commands/migrate";
import { runMigrateCheck } from "../../../cli/commands/migrate-check";
import { runMigrateCreate } from "../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../cli/program";
import { createLogger } from "../../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  number,
  text,
  textarea,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../i18n/per-language-storage";
import { setNonInteractive } from "../migrate/can-prompt";

/** The configuration the commands load. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

/** A database of the case's own, reached by the commands through `DATABASE_URL`. */
async function openDatabase(
  dialect: ReturnType<typeof getConfiguredTestDialects>[number]
): Promise<{ close(): Promise<void> }> {
  if (dialect === "sqlite") {
    const dir = await mkdtemp(join(tmpdir(), "nextly-per-language-upgrade-"));
    vi.stubEnv("DB_DIALECT", "sqlite");
    vi.stubEnv("DATABASE_URL", `file:${join(dir, "test.db")}`);
    _resetEnvCache();
    return {
      close: () => rm(dir, { recursive: true, force: true }),
    };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_plu_${randomBytes(8).toString("hex")}`;
  const server = (await createAdapter({
    type: dialect,
    url: serverUrl,
  })) as unknown as DrizzleAdapter;
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  return {
    async close() {
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

const DB = { migrationsDir: "./migrations" };

/** The app's one collection: two text-like fields and a number, none marked. */
function site(fields = postsFields()) {
  return defineConfig({
    collections: [defineCollection({ slug: "posts", fields })],
    db: DB,
  } as never);
}

function postsFields(textLike: { localized?: boolean } = {}) {
  return [
    text({ name: "headline", ...textLike }),
    textarea({ name: "summary", ...textLike }),
    number({ name: "views" }),
  ];
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`upgrading with no localization block — ${dialect}`, () => {
    let projectRoot: string;
    let database: { close(): Promise<void> };

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-per-language-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      database = await openDatabase(dialect);
    });

    afterEach(async () => {
      setNonInteractive(false);
      _resetPerLanguageStorage();
      await database.close();
      vi.restoreAllMocks();
      await rm(projectRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    /** A command's context; everything it says and prints is kept, in order. */
    function command(): { context: CommandContext; said: string[] } {
      const said: string[] = [];
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(String(message));
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
          cwd: projectRoot,
        } as CommandContext,
        said,
      };
    }

    /**
     * Run a command, turning `process.exit` into its code, with what it said and the error shape it
     * printed (`console.error`) as one text.
     */
    async function run(
      fn: (context: CommandContext) => Promise<void>
    ): Promise<{ exit: number | undefined; text: string }> {
      const { context, said } = command();
      const printed = vi
        .spyOn(console, "error")
        .mockImplementation((...parts: unknown[]) => {
          said.push(parts.map(String).join(" "));
        });
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        await fn(context);
        return { exit: undefined, text: said.join("\n") };
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return { exit: Number(match[1]), text: said.join("\n") };
        throw error;
      } finally {
        exit.mockRestore();
        printed.mockRestore();
      }
    }

    const migrate = () => run(c => runMigrate({ cwd: projectRoot }, c));
    const check = () => run(c => runMigrateCheck({ cwd: projectRoot }, c));
    const create = (name: string) =>
      run(c => runMigrateCreate(name, { cwd: projectRoot }, c));

    /** What every command's message must say about the move. */
    function expectMoveExplained(text: string) {
      // The fields that would move, and the table they would move to.
      expect(text).toMatch(/dc_posts: headline, summary -> dc_posts_locales/);
      // The number stays on the main table, so it is not named as moving.
      expect(text).not.toMatch(/views[^\n]*dc_posts_locales/);
      expect(text).toContain("Nothing is lost");
      // The two safe ways forward.
      expect(text).toContain("localized: false");
      expect(text).toContain("`localization`");
    }

    it("says the text moves to per-language tables, that nothing is lost, and how to keep it, at migrate, migrate:check and migrate:create", async () => {
      // The app as an earlier release migrated it: every text column on the main table.
      setPerLanguageStorage(false);
      setNonInteractive(true);
      loaded.config = site();
      const initial = await create("initial");
      expect(initial.exit, initial.text).toBeUndefined();
      const applied = await migrate();
      expect(applied.exit, applied.text).toBeUndefined();

      // The same app on this release.
      _resetPerLanguageStorage();
      const migrationsDir = join(projectRoot, "migrations");
      const filesBefore = (await readdir(migrationsDir)).sort();

      const drift = await migrate();
      expect(drift.exit, drift.text).toBe(1);
      expect(drift.text).toContain("SCHEMA_DRIFT");
      // Each drop reads as the move it is.
      expect(drift.text).toContain(
        "- drop_column dc_posts.headline (moves to dc_posts_locales)"
      );
      expectMoveExplained(drift.text);

      const checked = await check();
      expect(checked.exit, checked.text).toBe(1);
      expect(checked.text).toContain("SCHEMA_DRIFT");
      expect(checked.text).toContain(
        "drop_column dc_posts.headline (moves to dc_posts_locales)"
      );
      expectMoveExplained(checked.text);

      const refused = await create("upgrade");
      expect(refused.exit, refused.text).toBe(1);
      expect(refused.text).toContain("INPUT_REFUSED");
      expectMoveExplained(refused.text);
      // Refused, it wrote nothing.
      expect((await readdir(migrationsDir)).sort()).toEqual(filesBefore);

      // The first way forward: the fields marked `localized: false` stay on the main table. The
      // marking is a settings change, so `migrate:create` records it, in a migration that moves and
      // drops nothing, and `nextly migrate` then applies it.
      loaded.config = site(postsFields({ localized: false }));
      const recorded = await create("keep_text_on_main");
      expect(recorded.exit, recorded.text).toBeUndefined();
      const written = (await readdir(migrationsDir)).filter(
        f => f.endsWith(".sql") && !filesBefore.includes(f)
      );
      expect(written).toHaveLength(1);
      const sql = await readFile(join(migrationsDir, written[0]!), "utf-8");
      expect(sql).not.toMatch(/DROP|_locales/i);
      const kept = await migrate();
      expect(kept.exit, kept.text).toBeUndefined();
      const keptCheck = await check();
      expect(keptCheck.exit, keptCheck.text).toBeUndefined();
      expect(keptCheck.text).toContain("migrate:check OK");
    });
  });
}
