/**
 * `nextly media orphans` as the CLI runs it: what it connects, loads and
 * reads before it searches. The search itself is tested in
 * media-orphans.test.ts; here the database and the config loader are
 * stand-ins, so the order and the arguments can be observed.
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  calls: [] as string[],
  loadConfig: [] as unknown[],
  resolver: null as null | { getTable: (name: string) => unknown },
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async (options: unknown) => {
    seen.loadConfig.push(options);
    return { config: { storage: [] } };
  },
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    errors: [],
    dialect: "sqlite",
    databaseUrl: "file:unused.db",
  }),
  createCliAdapter: async () => ({
    getCapabilities: () => ({ dialect: "sqlite" }),
    setTableResolver: (resolver: { getTable: (name: string) => unknown }) => {
      seen.calls.push("setTableResolver");
      seen.resolver = resolver;
    },
    // As the real adapter does: a table with no registered schema is refused.
    select: async (table: string) => {
      seen.calls.push(`select ${table}`);
      if (!seen.resolver?.getTable(table)) {
        throw new Error(`Table "${table}" not found in schema registry`);
      }
      return [];
    },
    disconnect: async () => {},
  }),
}));

import { createProgram } from "../../program";

let dir: string;
let exits: number[];
beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "nextly-cmd-")));
  seen.calls.length = 0;
  seen.loadConfig.length = 0;
  seen.resolver = null;
  exits = [];
  vi.spyOn(process, "exit").mockImplementation(
    (code?: number | string | null) => {
      exits.push(Number(code ?? 0));
      return undefined as never;
    }
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("nextly media orphans, as the CLI runs it", () => {
  it("registers the tables before it reads media, and finds the project from --cwd", async () => {
    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "media",
      "orphans",
    ]);

    expect(exits).toEqual([0]);
    expect(seen.calls.indexOf("setTableResolver")).toBeGreaterThanOrEqual(0);
    expect(seen.calls.indexOf("setTableResolver")).toBeLessThan(
      seen.calls.indexOf("select media")
    );
    // The loader discovers the config from the project; a path is passed
    // only when one was given.
    expect(seen.loadConfig).toEqual([{ configPath: undefined, cwd: dir }]);
  });

  it("passes the config path when one is given", async () => {
    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "--config",
      "src/nextly.config.ts",
      "media",
      "orphans",
    ]);

    expect(seen.loadConfig).toEqual([
      { configPath: "src/nextly.config.ts", cwd: dir },
    ]);
  });
});
