/**
 * `new ServiceContainer(adapter)` reads the adapter's dialect's tables when it
 * is constructed. An adapter built directly from an adapter package was never
 * met by `createAdapter` or `registerServices`, which load them, so before a
 * load the constructor refuses, naming the one line that fixes it.
 *
 * MySQL is the dialect under test because the unit setup does not load it;
 * the test removes any MySQL load an earlier file left. The adapter is a fake
 * that only reports its dialect, since construction connects to nothing.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDialectTables } from "../../database/dialect-tables";
import { ServiceContainer } from "../index";

const mysqlAdapter = {
  getCapabilities: () => ({ dialect: "mysql" }),
} as unknown as DrizzleAdapter;

/** The loaded-dialect cache `dialect-tables.ts` keeps on `globalThis`. */
const cache = (
  globalThis as unknown as { __nextly_dialectTables: Map<string, unknown> }
).__nextly_dialectTables;
let earlierLoad: unknown;

beforeEach(() => {
  earlierLoad = cache.get("mysql");
  cache.delete("mysql");
});

afterEach(() => {
  if (earlierLoad === undefined) cache.delete("mysql");
  else cache.set("mysql", earlierLoad);
});

describe("a ServiceContainer for an adapter built directly", () => {
  it("before its dialect is loaded refuses, naming the fix", () => {
    expect(() => new ServiceContainer(mysqlAdapter)).toThrow(
      expect.objectContaining({
        code: "INTERNAL_ERROR",
        logContext: {
          reason: expect.stringMatching(
            /for an adapter built directly from an adapter package.*await loadDialectTables\("mysql"\) first/
          ),
        },
      })
    );
  });

  it("is constructed once that load ran", async () => {
    await loadDialectTables("mysql");

    expect(new ServiceContainer(mysqlAdapter)).toBeInstanceOf(ServiceContainer);
  });
});
