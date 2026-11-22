/**
 * One rule, three commands: `migrate:create`, `migrate:check` and `nextly migrate` agree on
 * whether the configuration holds a change no migration records — on every configured dialect.
 *
 * For each edit below, made with no migration written, `migrate:check` and `nextly migrate` both
 * fail, and `migrate:create` writes exactly one migration for it, after which both pass. Unedited,
 * all three agree there is nothing to do: `migrate:create` writes nothing and both pass. A command
 * judging by a rule of its own would disagree with the other two on one of these cases.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, number, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { definePlugin } from "../../../plugins/plugin-context";
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
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SLUG = "par_posts";
const PLUGIN = "@acme/par-forms";

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-parity-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, 0, 0, 0)));
});

afterEach(async () => {
  vi.useRealTimers();
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

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

function context(): CommandContext {
  const base = createLogger({ quiet: true });
  const silent = () => {};
  return {
    logger: {
      ...base,
      info: silent,
      warn: silent,
      success: silent,
      error: silent,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
}

/** `fn`'s outcome: "ok", or "failed" where it exited non-zero or threw. */
async function outcome(fn: () => Promise<void>): Promise<"ok" | "failed"> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return "ok";
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    return match !== null && Number(match[1]) === 0 ? "ok" : "failed";
  } finally {
    exit.mockRestore();
  }
}

const migrationFiles = () =>
  readdirSync(join(dir, "migrations")).filter(f => f.endsWith(".sql")).length;

/** `migrate:create` over `config`: how many migration files it wrote. */
async function migrateCreate(config: unknown): Promise<number> {
  const before = migrationFiles();
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 16, 12, 0, 0, clock)));
  setNonInteractive(true);
  const result = await outcome(() =>
    runMigrateCreate(
      `step${clock}`,
      { cwd: dir, acceptDataLoss: true },
      context()
    )
  ).finally(() => setNonInteractive(false));
  expect(result).toBe("ok");
  return migrationFiles() - before;
}

async function check(config: unknown) {
  loaded.config = config;
  return outcome(() => runMigrateCheck({ cwd: dir }, context()));
}

async function migrate(config: unknown) {
  loaded.config = config;
  setNonInteractive(true);
  return outcome(() =>
    runMigrate(
      // Consent given, so a run fails only for the rule these commands share.
      { cwd: dir, throwOnFailure: true, acceptDataLoss: true } as Parameters<
        typeof runMigrate
      >[0],
      context()
    )
  ).finally(() => setNonInteractive(false));
}

const config = (
  fields: (ReturnType<typeof text> | ReturnType<typeof number>)[],
  extra: { description?: string; permissions?: string[] } = {}
) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        ...(extra.description === undefined
          ? {}
          : { description: extra.description }),
        fields,
      }),
    ],
    plugins: [
      definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.1",
        contributes: {
          permissions: (extra.permissions ?? ["export"]).map(action => ({
            action,
            resource: "par_submissions",
          })),
        },
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

const TITLE = text({ name: "title" });
const BASE = config([TITLE], { description: "Posts" });

describe.each(getConfiguredTestDialects())(
  "migrate:create, migrate:check and nextly migrate judge one rule (%s)",
  dialect => {
    beforeEach(async () => {
      instance = await boot(dialect);
      expect(await migrateCreate(BASE)).toBe(1);
      expect(await migrate(BASE)).toBe("ok");
    });

    it("unedited: nothing to write, and both pass", async () => {
      expect(await check(BASE)).toBe("ok");
      expect(await migrate(BASE)).toBe("ok");
      expect(await migrateCreate(BASE)).toBe(0);
    });

    it.each([
      [
        "a field added",
        config([TITLE, text({ name: "body" })], { description: "Posts" }),
      ],
      [
        "a field's type changed",
        config([number({ name: "title" })], { description: "Posts" }),
      ],
      ["a setting changed", config([TITLE], { description: "Articles" })],
      [
        "a plugin permission added",
        config([TITLE], {
          description: "Posts",
          permissions: ["export", "archive"],
        }),
      ],
    ])(
      "%s: both fail, migrate:create writes one migration, then both pass",
      async (_edit, edited) => {
        expect(await check(edited)).toBe("failed");
        expect(await migrate(edited)).toBe("failed");
        expect(await migrateCreate(edited)).toBe(1);
        expect(await check(edited)).toBe("ok");
        expect(await migrate(edited)).toBe("ok");
      }
    );
  }
);
