/**
 * `migrate:create --record-snapshot` exits 2 whenever it has nothing to record, as a plain run
 * exits 2 when it has nothing to write, so a script can tell "commit the new files" from "nothing
 * to do" by the code alone. Driven over the command itself, since the project with no entities
 * is decided there, before any migration is generated.
 */
import { mkdtempSync, rmSync } from "node:fs";
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
  dir = mkdtempSync(join(tmpdir(), "nextly-record-snapshot-"));
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
async function migrateCreate(
  config: unknown,
  recordSnapshot: boolean
): Promise<number | undefined> {
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
      recordSnapshot ? undefined : "change",
      { cwd: dir, nonInteractive: true, recordSnapshot },
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

const project = (collections: ReturnType<typeof defineCollection>[]) =>
  defineConfig({
    collections,
    db: { migrationsDir: "./migrations" },
  } as never);

describe("migrate:create --record-snapshot with nothing to record", () => {
  it("exits 2 for a project with no entities", async () => {
    expect(await migrateCreate(project([]), true)).toBe(2);
  });

  it("exits 2 for a project whose snapshot records its translated fields, whatever the config holds", async () => {
    const posts = (fields: ReturnType<typeof text>[]) =>
      project([defineCollection({ slug: "posts", fields })]);
    expect(
      await migrateCreate(posts([text({ name: "headline" })]), false)
    ).toBeUndefined();

    // A change still to migrate, which a recording run refuses only where there is a record to
    // write.
    expect(
      await migrateCreate(
        posts([text({ name: "headline" }), text({ name: "summary" })]),
        true
      )
    ).toBe(2);
  });
});
