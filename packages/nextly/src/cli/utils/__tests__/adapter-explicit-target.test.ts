/**
 * A command that names its database opens it whatever the environment says about a database.
 *
 * The open hands the dialect and URL it was given to the adapter factory, so neither
 * `DB_DIALECT` nor `DATABASE_URL` needs to be set. The factory still reads the pool and timeout
 * settings from the environment, and reading them must not ask the environment for a database
 * target of its own: one validated in full defaults to PostgreSQL and refuses the missing
 * `DATABASE_URL`, so a named SQLite database would never be reached.
 *
 * Nothing is mocked: the real factory opens a real in-memory SQLite database, from an
 * environment cache nobody has filled yet.
 *
 * @module cli/utils/__tests__/adapter-explicit-target.test
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetEnvCache } from "../../../shared/lib/env";
import { createCliAdapter } from "../adapter";

const CLEARED = [
  "DB_DIALECT",
  "DATABASE_URL",
  "SQLITE_PATH",
  "DB_POOL_MAX",
] as const;

let saved: Partial<Record<(typeof CLEARED)[number], string>> = {};

beforeEach(() => {
  saved = {};
  for (const name of CLEARED) {
    if (process.env[name] !== undefined) saved[name] = process.env[name];
    delete process.env[name];
  }
  _resetEnvCache();
});

afterEach(() => {
  for (const name of CLEARED) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  _resetEnvCache();
});

describe("a command that names its database", () => {
  it("opens a named SQLite database with no database in the environment", async () => {
    const adapter = await createCliAdapter({
      dialect: "sqlite",
      databaseUrl: "file::memory:",
    });
    try {
      expect(adapter.getCapabilities().dialect).toBe("sqlite");
    } finally {
      await adapter.disconnect();
    }
  });

  it("still refuses a pool setting the environment gets wrong", async () => {
    process.env.DB_POOL_MAX = "0";

    await expect(
      createCliAdapter({ dialect: "sqlite", databaseUrl: "file::memory:" })
    ).rejects.toThrow();
  });
});
