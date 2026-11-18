/**
 * A Builder entity the definition file lost is refused by `migrate:check` and `migrate:create`,
 * naming the entity and the file, rather than planned as a drop of its table.
 *
 * Each case makes the entity through the Schema Builder's own entry point, which writes its
 * migration and the snapshot recording it as the Builder's, then removes the definition file the
 * save wrote, as a project that never committed it would be cloned. A Builder delete is the
 * control: it writes the migration that drops the entity, so neither command refuses after it.
 *
 * Run for a collection, a Single and a field group, on every configured dialect.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import { exitWithError } from "../../errors";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
// `cli/program` imports every command; the commands driven here are handed their context.
vi.mock("../../program", () => ({
  createContext: () => ({ logger: createQuietLogger() }),
}));
// The commands load the project's configuration through this loader; here it is the one the
// instance was booted with.
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

function createQuietLogger() {
  const none = () => {};
  return { debug: none, info: none, warn: none, error: none, success: none };
}

const MIGRATIONS = "./database/history";
const DEFINITION = "./schema/builder.json";
const PROJECT = defineConfig({
  collections: [],
  db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
});

const FIELDS = [{ name: "heading", type: "text" }];

/** One kind of entity the Builder makes, and how its Builder creates and deletes it. */
interface Kind {
  /** The kind, as the refusal names it. */
  word: string;
  slug: string;
  create(): Promise<unknown>;
  remove(): Promise<unknown>;
}

const KINDS: Kind[] = [
  {
    word: "collection",
    slug: "lost_cases",
    create: () =>
      dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "lost_cases", label: "Lost cases", fields: FIELDS }
      ),
    remove: () =>
      dispatchCollections(
        {} as ServiceContainer,
        "deleteCollection",
        { collectionName: "lost_cases" },
        undefined
      ),
  },
  {
    word: "Single",
    slug: "lost-notice",
    create: () =>
      dispatchSingles(
        "createSingle",
        {},
        { slug: "lost-notice", label: "Lost notice", fields: FIELDS }
      ),
    remove: () =>
      dispatchSingles("deleteSingle", { slug: "lost-notice" }, undefined),
  },
  {
    word: "field group",
    slug: "lost-meta",
    create: () =>
      dispatchComponents(
        "createComponent",
        {},
        { slug: "lost-meta", label: "Lost meta", fields: FIELDS }
      ),
    remove: () =>
      dispatchComponents("deleteComponent", { slug: "lost-meta" }, undefined),
  },
];

let instance: TestNextly | undefined;
let basePath: string;
const previousEnv = {
  dialect: process.env.DB_DIALECT,
  url: process.env.DATABASE_URL,
};

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-definition-lost-"));
  // The Builder's save applies its change, and records it, in development.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  for (const [key, value] of [
    ["DB_DIALECT", previousEnv.dialect],
    ["DATABASE_URL", previousEnv.url],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  _resetEnvCache();
  await rm(basePath, { recursive: true, force: true });
});

describe.each(getConfiguredTestDialects())(
  "a Builder entity the definition file lost (%s)",
  dialect => {
    /** The instance, on SQLite over a file. */
    async function boot(): Promise<TestNextly> {
      const db = { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION };
      if (dialect !== "sqlite") {
        instance = await createTestNextly({
          dialect: dialect as TestDialect,
          basePath,
          db,
        });
        return instance;
      }
      const url = `file:${join(basePath, "test.db")}`;
      process.env.DB_DIALECT = "sqlite";
      process.env.DATABASE_URL = url;
      _resetEnvCache();
      const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
        typeof createAdapter
      >[0]);
      instance = await createTestNextly({ adapter, basePath, db });
      return instance;
    }

    const migrationsDir = () => join(basePath, "database", "history");
    const migrationFiles = () =>
      existsSync(migrationsDir())
        ? readdirSync(migrationsDir())
            .filter(f => f.endsWith(".sql"))
            .sort()
        : [];

    /**
     * Run a command over the project, ended as its action ends it: its exit code and everything
     * it printed or said.
     */
    async function command(
      run: (context: CommandContext) => Promise<void>
    ): Promise<{ code: number | undefined; said: string }> {
      loaded.config = PROJECT;
      const restore = {
        dialect: process.env.DB_DIALECT,
        url: process.env.DATABASE_URL,
      };
      // Neither command connects: each needs only the dialect.
      process.env.DB_DIALECT = dialect;
      process.env.DATABASE_URL =
        dialect === "sqlite"
          ? `file:${join(basePath, "test.db")}`
          : dialect === "mysql"
            ? "mysql://unused:unused@localhost:1/unused"
            : "postgres://unused:unused@localhost:1/unused";
      _resetEnvCache();
      const said: string[] = [];
      const capture = (message: string) => {
        said.push(message);
      };
      const context = {
        logger: {
          ...createLogger({ quiet: true }),
          error: capture,
          info: capture,
          success: capture,
        },
        options: {},
        cwd: basePath,
      } as CommandContext;
      const printed = vi.spyOn(console, "error").mockImplementation(message => {
        said.push(String(message));
      });
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        try {
          await run(context);
        } catch (error) {
          // An exit the run already took goes on; any other error is printed, as the action does.
          if (error instanceof Error && /^exit \d+$/.test(error.message)) {
            throw error;
          }
          exitWithError(context.logger, error);
        }
        return { code: undefined, said: said.join("\n") };
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return { code: Number(match[1]), said: said.join("\n") };
        throw error;
      } finally {
        exit.mockRestore();
        printed.mockRestore();
        for (const [key, value] of [
          ["DB_DIALECT", restore.dialect],
          ["DATABASE_URL", restore.url],
        ] as const) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        _resetEnvCache();
      }
    }

    const check = () =>
      command(context => runMigrateCheck({ cwd: basePath }, context));
    const create = () =>
      command(context => {
        // As `--non-interactive` does: nothing is asked.
        setNonInteractive(true);
        return runMigrateCreate("after", { cwd: basePath }, context).finally(
          () => setNonInteractive(false)
        );
      });

    describe.each(KINDS)("a $word", kind => {
      it("is refused by both commands, naming it and the file, with no drop planned", async () => {
        await boot();
        await kind.create();
        const written = migrationFiles();
        // The save wrote its migration, whose snapshot records the entity as the Builder's.
        expect(written.length).toBeGreaterThan(0);
        expect(existsSync(join(basePath, "schema", "builder.json"))).toBe(true);
        rmSync(join(basePath, "schema", "builder.json"));

        const checked = await check();
        const created = await create();

        for (const ran of [checked, created]) {
          expect(ran.code, ran.said).toBe(1);
          expect(ran.said).toContain("BUILDER_DEFINITION_MISSING");
          expect(ran.said).toContain(`${kind.word} '${kind.slug}'`);
          expect(ran.said).toContain(DEFINITION);
        }
        // No migration written to drop its table.
        expect(migrationFiles()).toEqual(written);
      }, 60_000);

      it("is not refused once the Builder deleted it", async () => {
        await boot();
        await kind.create();
        await kind.remove();
        const written = migrationFiles();

        const checked = await check();
        const created = await create();

        expect(checked.code, checked.said).toBeUndefined();
        expect(created.code, created.said).toBeUndefined();
        expect(created.said).not.toContain("BUILDER_DEFINITION_MISSING");
        expect(migrationFiles()).toEqual(written);
      }, 60_000);
    });
  }
);
