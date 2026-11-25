/**
 * `nextly migrate:status --json` says what kept it from its database.
 *
 * What would separate a correct answer from a broken one:
 * - a failure after the database opened (its tables' code) said to be a failed
 *   connection;
 * - a failed connection no longer said to be one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeError } from "../../../errors/index";
import { NextlyError } from "../../../errors/nextly-error";

const createAdapter = vi.fn();
const installRegistryResolver = vi.fn();

vi.mock("../../../database/factory", () => ({
  createAdapter: () => createAdapter(),
}));
vi.mock("../../utils/registry-resolver", () => ({
  installRegistryResolver: () => installRegistryResolver(),
}));
// The real open, over the stand-ins above; only the environment is given.
vi.mock("../../utils/adapter", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/adapter")>()),
  validateDatabaseEnv: () => ({
    valid: true,
    errors: [],
    dialect: "postgresql",
    databaseUrl: "postgres://localhost:5432/app",
  }),
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: {}, dependencies: [] }),
}));

const { runMigrateStatus } = await import("../migrate-status");

let written: string;
beforeEach(() => {
  written = "";
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    written += String(chunk);
    return true;
  });
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    written += `${parts.map(String).join(" ")}\n`;
  });
  vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  createAdapter.mockReset();
  installRegistryResolver.mockReset();
});

/** What the command answered in JSON. */
async function answered(): Promise<unknown> {
  const logger = new Proxy({}, { get: () => () => {} });
  await expect(
    runMigrateStatus(
      { json: true } as Parameters<typeof runMigrateStatus>[0],
      { logger, options: {} } as unknown as Parameters<
        typeof runMigrateStatus
      >[1]
    )
  ).rejects.toThrow("exit 1");
  return (JSON.parse(written) as { error: unknown }).error;
}

describe("migrate:status --json, when its database cannot be used", () => {
  it.each([
    new TypeError("the tables could not be read"),
    // As Nextly's own code throws, with a code: still not a failed connection.
    NextlyError.internal({
      logContext: { reason: "the tables could not be read" },
    }),
  ])("names the failure itself where the database opened: %s", async error => {
    createAdapter.mockResolvedValue({ disconnect: async () => {} });
    installRegistryResolver.mockImplementation(() => {
      throw error;
    });

    expect(await answered()).toBe(describeError(error));
  });

  it("says the connection failed where it did", async () => {
    createAdapter.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const error = await answered();
    expect(error).toMatch(/^Failed to connect to database: /);
    expect(error).toContain("connect ECONNREFUSED");
  });

  it("reads as before where the open refuses with a code of its own", async () => {
    createAdapter.mockRejectedValue(
      new NextlyError({
        code: "NEXTLY_POSTGRES_SCHEMA_MOVED",
        publicMessage: "db.postgres.schema is moved.",
      })
    );

    expect(await answered()).toMatch(/^Failed to connect to database: /);
  });
});
