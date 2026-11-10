/**
 * `nextly migrate:create` writes a plugin's declared permissions as a migration even in an app
 * with no table yet: a permission travels as a migration whatever the schema holds.
 *
 * The command is run itself, offline (it needs only the dialect), with the loader handed the
 * config each step declares. What separates the correct command from the broken one is the file
 * existing: a command that stops at "no collections defined" writes nothing.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../../config";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { definePlugin } from "../../../plugins/plugin-context";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
// `../program` imports every command; the command under test is handed its context here.
vi.mock("../../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const PLUGIN = "@acme/reports";

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-permissions-only-cli-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // `migrate:create` needs only the dialect; it never connects.
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${join(dir, "unused.db")}`;
  _resetEnvCache();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** `migrate:create` over `config`; the code it exits with, if any. */
async function migrateCreate(config: unknown): Promise<number | undefined> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 12, 0, 0, clock)));
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const context = {
    logger: createLogger({ quiet: true }),
    options: {},
    cwd: dir,
  } as CommandContext;
  setNonInteractive(true);
  try {
    await runMigrateCreate("change", { cwd: dir }, context);
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    setNonInteractive(false);
    exit.mockRestore();
  }
}

/** Every migration file's content, oldest first. */
function migrations(): string[] {
  const folder = join(dir, "migrations");
  return readdirSync(folder)
    .filter(f => f.endsWith(".sql"))
    .sort()
    .map(f => readFileSync(join(folder, f), "utf-8"));
}

/** An app with no collection, whose plugin declares `actions` on reports. */
const appWith = (actions: string[]) =>
  defineConfig({
    collections: [],
    plugins: [
      definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.1",
        contributes: {
          permissions: actions.map(action => ({ action, resource: "reports" })),
        },
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

describe("an app with no table yet", () => {
  it("writes its plugin's permissions as a migration, and a later one it adds", async () => {
    expect(await migrateCreate(appWith(["export"]))).toBeUndefined();
    expect(migrations()).toHaveLength(1);
    expect(migrations()[0]).toContain(
      `-- Permissions: ${PLUGIN}: + export-reports`
    );

    expect(await migrateCreate(appWith(["export", "archive"]))).toBeUndefined();
    expect(migrations()).toHaveLength(2);
    expect(migrations()[1]).toContain(
      `-- Permissions: ${PLUGIN}: + archive-reports`
    );
  });
});
