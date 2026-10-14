/**
 * What `rateLimit.store` selects, for the limit store contract and for core's
 * own limits, and that an app's store of the earlier contract keeps serving
 * those.
 */
import { describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { InMemoryRateLimitStore } from "../../../middleware/rate-limit";
import { sanitizeConfig } from "../../../shared/types/config";
import { resolveStoreSetting } from "../limit-store-setting";
import { createMemoryLimitStore } from "../memory-limit-store";
import { selectLimitStore } from "../select-limit-store";

/** An adapter the selection may hand the database store, and nothing calls. */
const adapter = {
  getCapabilities: () => ({ dialect: "sqlite" }),
} as unknown as DrizzleAdapter;

describe("rateLimit.store", () => {
  it("selects memory by default and when named", () => {
    expect(resolveStoreSetting(undefined)).toEqual({ selection: "memory" });
    expect(resolveStoreSetting("memory")).toEqual({ selection: "memory" });
  });

  it("selects the database when named", () => {
    expect(resolveStoreSetting("database")).toEqual({ selection: "database" });
  });

  it("selects an app's own store of the limit store contract", () => {
    const own = createMemoryLimitStore();
    expect(resolveStoreSetting(own)).toEqual({ selection: own });
  });

  it("keeps an app's store of the earlier contract for core's own limits, and counts newer limits in memory", () => {
    const earlier = new InMemoryRateLimitStore();
    expect(resolveStoreSetting(earlier)).toEqual({
      selection: "memory",
      legacy: earlier,
    });
  });

  it("refuses anything else, naming the setting", () => {
    expect(() => resolveStoreSetting("redis")).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [expect.objectContaining({ path: "rateLimit.store" })],
        },
      })
    );
  });

  it("reaches the sanitized config under both contracts", () => {
    const earlier = new InMemoryRateLimitStore();
    const withEarlier = sanitizeConfig({
      rateLimit: { enabled: true, store: earlier },
    });
    expect(withEarlier.rateLimit?.store).toBe(earlier);
    expect(withEarlier.rateLimit?.limitStore).toBe("memory");

    const withDatabase = sanitizeConfig({
      rateLimit: {
        enabled: true,
        store: "database",
        singleInstance: true,
        maxEntries: 50,
      },
    });
    // Core's own limits see no store of the earlier contract, as before.
    expect(withDatabase.rateLimit?.store).toBeUndefined();
    expect(withDatabase.rateLimit?.limitStore).toBe("database");
    expect(withDatabase.rateLimit?.singleInstance).toBe(true);
    expect(withDatabase.rateLimit?.maxEntries).toBe(50);

    const byDefault = sanitizeConfig({});
    expect(byDefault.rateLimit?.limitStore).toBe("memory");
    expect(byDefault.rateLimit?.singleInstance).toBe(false);
  });

  it("refuses a bound that is not a positive whole number", () => {
    expect(() =>
      sanitizeConfig({ rateLimit: { enabled: true, maxEntries: 0 } })
    ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() =>
      sanitizeConfig({ rateLimit: { enabled: true, maxEntries: 1.5 } })
    ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("builds the store each selection names: memory unshared, the database and an app's own shared", async () => {
    const memory = selectLimitStore("memory", { adapter, secret: "s" });
    expect(memory.store.shared).toBe(false);

    const database = selectLimitStore("database", { adapter, secret: "s" });
    expect(database.store.shared).toBe(true);
    await database.close();

    const own = { ...createMemoryLimitStore(), shared: true };
    expect(selectLimitStore(own, { adapter, secret: "s" }).store.shared).toBe(
      true
    );
  });
});
