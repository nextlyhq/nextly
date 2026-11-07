/**
 * A start that failed (the database down, say) is started again by the next
 * `getCachedNextly()`, with the config the app handed `getNextly`, so a worker
 * recovers once the database is back rather than refusing every read as
 * "called before initialization" until it restarts.
 *
 * @module __tests__/init-retries-failed-start
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** Whether the next service registration fails, as a database down makes it. */
let failNext = false;

vi.mock("../di/register", async importOriginal => {
  const real = await importOriginal<typeof import("../di/register")>();
  return {
    ...real,
    registerServices: vi.fn(
      async (...args: Parameters<typeof real.registerServices>) => {
        if (failNext) {
          failNext = false;
          throw new Error("database down");
        }
        return real.registerServices(...args);
      }
    ),
  };
});

const { defineConfig } = await import("../collections/config/define-config");
const { getCachedNextly, getNextly, shutdownNextly } = await import("../init");

afterEach(async () => {
  failNext = false;
  await shutdownNextly();
});

describe("getCachedNextly() after a failed start", () => {
  it("starts Nextly again with the failed start's config", async () => {
    failNext = true;
    await expect(getNextly({ config: defineConfig({}) })).rejects.toThrow(
      "database down"
    );

    // The database is back: the read starts Nextly rather than refusing.
    const nextly = await getCachedNextly();
    expect(typeof nextly.find).toBe("function");
  });

  it("still refuses when nothing ever tried to start", async () => {
    // The control: with no start made, there is no config to start with.
    await expect(getCachedNextly()).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
  });

  it("does not start again once shut down", async () => {
    failNext = true;
    await expect(getNextly({ config: defineConfig({}) })).rejects.toThrow(
      "database down"
    );
    await shutdownNextly();

    await expect(getCachedNextly()).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
  });
});
