/**
 * `nextly migrate:status --json` says what kept it from its database.
 *
 * What would separate a correct answer from a broken one:
 * - a failure after the database opened (its tables' code) said to be a failed
 *   connection;
 * - a failed connection no longer said to be one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionFailure } from "../../errors/areas/database";

const createCliAdapter = vi.fn();

vi.mock("../../utils/adapter", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/adapter")>()),
  validateDatabaseEnv: () => ({
    valid: true,
    errors: [],
    dialect: "sqlite",
    databaseUrl: "file:./app.db",
  }),
  createCliAdapter: () => createCliAdapter(),
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
  createCliAdapter.mockReset();
});

/** What the command answered in JSON, the open having failed with `error`. */
async function answered(error: Error): Promise<unknown> {
  createCliAdapter.mockRejectedValue(error);
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
  it("names the failure itself where the database opened", async () => {
    expect(await answered(new TypeError("the tables could not be read"))).toBe(
      "the tables could not be read"
    );
  });

  it("says the connection failed where it did", async () => {
    const error = await answered(
      connectionFailure("sqlite", new Error("unable to open database file"))
    );
    expect(error).toMatch(/^Failed to connect to database: /);
    expect(error).toContain("unable to open database file");
  });
});
