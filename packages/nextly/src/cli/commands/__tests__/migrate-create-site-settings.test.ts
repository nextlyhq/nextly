/**
 * Site content settings are data, not schema: a change to the email setup or
 * the admin's general settings never appears in a migration.
 *
 * `migrate:create` is driven itself over a config that changes ONLY those, and
 * must find nothing to write (exit 2, no new file). The positive control is the
 * same run after a collection's description changes, which must write one: a
 * command that wrote nothing for any settings change would pass the first half
 * on its own.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-site-settings-"));
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
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 28, 12, 0, 0, clock)));
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const context = {
    logger: createLogger({ quiet: true }),
    options: {},
    cwd: dir,
  } as CommandContext;
  try {
    await runMigrateCreate(
      "change",
      { cwd: dir, nonInteractive: true },
      context
    );
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

function migrationFiles(): string[] {
  return readdirSync(join(dir, "migrations")).filter(f => f.endsWith(".sql"));
}

const project = (args: {
  description: string;
  email: Record<string, unknown>;
  siteName: string;
}) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: "posts",
        description: args.description,
        fields: [text({ name: "headline" })],
      }),
    ],
    email: args.email,
    admin: { branding: { logoText: args.siteName } },
    db: { migrationsDir: "./migrations" },
  } as never);

describe("site content settings never appear in a migration", () => {
  it("a changed email setup and general settings write nothing", async () => {
    expect(
      await migrateCreate(
        project({
          description: "Blog posts",
          email: { defaultFrom: "hello@example.com" },
          siteName: "Example",
        })
      )
    ).toBeUndefined();
    expect(migrationFiles()).toHaveLength(1);

    expect(
      await migrateCreate(
        project({
          description: "Blog posts",
          email: { defaultFrom: "news@example.org" },
          siteName: "Example Inc.",
        })
      )
    ).toBe(2);
    expect(migrationFiles()).toHaveLength(1);

    // The control: a collection's own setting does write one.
    expect(
      await migrateCreate(
        project({
          description: "Articles",
          email: { defaultFrom: "news@example.org" },
          siteName: "Example Inc.",
        })
      )
    ).toBeUndefined();
    expect(migrationFiles()).toHaveLength(2);
  });
});
