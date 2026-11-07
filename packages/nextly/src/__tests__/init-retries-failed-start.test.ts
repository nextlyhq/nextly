/**
 * A start that failed (the database down, say) is started again by the next
 * `getCachedNextly()`, with the complete options the app handed `getNextly`,
 * so a worker recovers once the database is back rather than refusing every
 * read as "called before initialization" until it restarts.
 *
 * A start the app registered (`registerNextlyStart`) runs only for a read that
 * finds nothing started, so an app's own `getNextly` with its own options is
 * never preempted by it.
 *
 * @module __tests__/init-retries-failed-start
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** Whether the next service registration fails, as a database down makes it. */
let failNext = false;
/** The `basePath` each service registration was given, a top-level option. */
const registeredBasePaths: (string | undefined)[] = [];

vi.mock("../di/register", async importOriginal => {
  const real = await importOriginal<typeof import("../di/register")>();
  return {
    ...real,
    registerServices: vi.fn(
      async (...args: Parameters<typeof real.registerServices>) => {
        registeredBasePaths.push(args[0].basePath);
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
const { getCachedNextly, getNextly, registerNextlyStart, shutdownNextly } =
  await import("../init");

afterEach(async () => {
  failNext = false;
  registeredBasePaths.length = 0;
  await shutdownNextly();
  // A registered start outlives `shutdownNextly` by design, and the API has no
  // way to take one back, so each test leaves none behind for the next.
  delete (globalThis as { __nextly_start?: unknown }).__nextly_start;
  // The shutdown above leaves the process stopped; each test starts afresh.
  delete (globalThis as { __nextly_stopped?: unknown }).__nextly_stopped;
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

  it("starts again with the complete options, a top-level one included", async () => {
    // `basePath` is given beside the config, as an app passes a custom
    // adapter, logger or service override: a retry with the config alone
    // would lose it.
    failNext = true;
    await expect(
      getNextly({ config: defineConfig({}), basePath: "/cms" })
    ).rejects.toThrow("database down");

    await getCachedNextly();
    expect(registeredBasePaths).toEqual(["/cms", "/cms"]);
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

describe("getCachedNextly() with a start the app registered", () => {
  it("runs the start when a read finds nothing started", async () => {
    const start = vi.fn(() =>
      getNextly({ config: defineConfig({}), basePath: "/registered" })
    );
    registerNextlyStart(start);

    const nextly = await getCachedNextly();
    expect(typeof nextly.find).toBe("function");
    expect(start).toHaveBeenCalledTimes(1);
    expect(registeredBasePaths).toEqual(["/registered"]);
  });

  it("does not run it after a shutdown, until the app starts Nextly again", async () => {
    // A late read during teardown must not reopen what was just shut down.
    const start = vi.fn(() =>
      getNextly({ config: defineConfig({}), basePath: "/registered" })
    );
    registerNextlyStart(start);
    await getNextly({ config: defineConfig({}), basePath: "/app" });
    await shutdownNextly();

    await expect(getCachedNextly()).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
    });
    expect(start).not.toHaveBeenCalled();

    // An explicit start ends the shutdown, and reads answer again; the
    // registered start is still never what started it.
    await getNextly({ config: defineConfig({}), basePath: "/app" });
    const nextly = await getCachedNextly();
    expect(typeof nextly.find).toBe("function");
    expect(start).not.toHaveBeenCalled();
  });

  it("does not run it once the app's own getNextly started Nextly", async () => {
    const start = vi.fn(() =>
      getNextly({ config: defineConfig({}), basePath: "/registered" })
    );
    registerNextlyStart(start);
    // The app's page starts Nextly with options of its own first.
    await getNextly({ config: defineConfig({}), basePath: "/app" });

    await getCachedNextly();
    expect(start).not.toHaveBeenCalled();
    expect(registeredBasePaths).toEqual(["/app"]);
  });

  it("retries a failed start before running the registered one", async () => {
    const start = vi.fn(() =>
      getNextly({ config: defineConfig({}), basePath: "/registered" })
    );
    registerNextlyStart(start);
    failNext = true;
    await expect(
      getNextly({ config: defineConfig({}), basePath: "/app" })
    ).rejects.toThrow("database down");

    await getCachedNextly();
    expect(start).not.toHaveBeenCalled();
    expect(registeredBasePaths).toEqual(["/app", "/app"]);
  });
});
