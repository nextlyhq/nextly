/**
 * An adapter handed to `registerServices` (`config.adapter`) was not made by
 * `createAdapter`, which is where a dialect's tables are otherwise loaded, so
 * boot loads the dialect the handed adapter reports.
 *
 * The adapter here reports MySQL, which the unit setup does not load, and the
 * test removes any MySQL load an earlier file left, so the tables can only be
 * loaded afterwards by boot. The fake is too thin to finish registration, so
 * boot rejects later on; the tables are read after that rejection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadedDialect } from "../../database/dialect-tables";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");

const mysqlAdapter = {
  connect: () => undefined,
  getDrizzle: () => ({}),
  getCapabilities: () => ({ dialect: "mysql" }),
};

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

describe("an adapter handed to registerServices", () => {
  it("has its dialect's tables loaded by boot", async () => {
    expect(() => loadedDialect("mysql")).toThrow();

    await expect(
      registerServices({
        adapter: mysqlAdapter,
        collections: [],
      } as unknown as Parameters<typeof registerServices>[0])
    ).rejects.toThrow();

    expect(loadedDialect("mysql").dialect).toBe("mysql");
  });
});
