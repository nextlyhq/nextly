/**
 * A dialect's tables are loaded where its adapter is created, and a read
 * before that fails naming the cause rather than answering with nothing.
 *
 * MySQL and PostgreSQL are the dialects under test because the unit setup
 * does not load them; each test removes any load of them an earlier file
 * left, so a load seen here can only come from the code the test drives. The
 * adapter package is mocked, so nothing connects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadedDialect } from "../dialect-tables";

/** The loaded-dialect cache `dialect-tables.ts` keeps on `globalThis`. */
const cache = (
  globalThis as unknown as { __nextly_dialectTables: Map<string, unknown> }
).__nextly_dialectTables;
const originalEnv = { ...process.env };
const UNDER_TEST = ["mysql", "postgresql"];
const earlierLoads = new Map<string, unknown>();

beforeEach(() => {
  for (const dialect of UNDER_TEST) {
    earlierLoads.set(dialect, cache.get(dialect));
    cache.delete(dialect);
  }
  vi.resetModules();
  vi.doMock("@nextlyhq/adapter-mysql", () => ({
    createMySqlAdapter: () => ({ connect: async () => undefined }),
  }));
});

afterEach(() => {
  for (const [dialect, earlier] of earlierLoads) {
    if (earlier === undefined) cache.delete(dialect);
    else cache.set(dialect, earlier);
  }
  vi.doUnmock("@nextlyhq/adapter-mysql");
  process.env = { ...originalEnv };
});

describe("reading a dialect's tables", () => {
  it("before it is loaded fails, naming the cause", async () => {
    const { getDialectTables } = await import("../index");

    // Matched by its fields: `vi.resetModules` gives this read its own copy
    // of the `NextlyError` class.
    expect(() => getDialectTables("mysql")).toThrow(
      expect.objectContaining({
        code: "INTERNAL_ERROR",
        logContext: {
          reason: expect.stringContaining(
            "the mysql tables were read before that dialect was loaded"
          ),
        },
      })
    );
  });

  it("through the published core schema, before it is loaded, names the fix", async () => {
    const { getCoreSchema } = await import("../../schemas/index");

    expect(() => getCoreSchema("mysql")).toThrow(
      expect.objectContaining({
        logContext: {
          reason: expect.stringContaining(
            'await loadDialectTables("mysql") first'
          ),
        },
      })
    );
  });

  it("through the published core schema answers once the entry's loader ran", async () => {
    const { getCoreSchema, loadDialectTables } = await import(
      "../../schemas/index"
    );

    await loadDialectTables("mysql");

    expect(getCoreSchema("mysql").tables.length).toBeGreaterThan(0);
  });

  it("after createAdapter answers with that dialect's tables", async () => {
    const { createAdapter } = await import("../factory");
    const { getDialectTables } = await import("../index");

    await createAdapter({ type: "mysql", url: "mysql://u:p@localhost/db" });

    expect(loadedDialect("mysql").dialect).toBe("mysql");
    expect(getDialectTables("mysql")).toBe(loadedDialect("mysql").tables);
  });

  it("after the CLI creates its adapter answers too", async () => {
    // `createCliAdapter` is what every CLI command, and `withAdapter`, use.
    const { createCliAdapter } = await import("../../cli/utils/adapter");

    await createCliAdapter({ databaseUrl: "mysql://u:p@localhost/db" });

    expect(loadedDialect("mysql").dialect).toBe("mysql");
  });

  it("accepts `postgres` for PostgreSQL, as callers spell it", async () => {
    const { loadDialectTables } = await import("../dialect-tables");

    await loadDialectTables("postgres");

    expect(loadedDialect("postgres")).toBe(loadedDialect("postgresql"));
  });
});
