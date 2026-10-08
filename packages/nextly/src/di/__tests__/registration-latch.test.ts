/**
 * Two boot paths reaching `registerServices` at once register once.
 *
 * The instrumentation/Direct API boot and the first request both call it, and
 * registration now waits on the migrate lock before it marks itself
 * registered — a window wide enough for the second caller to start its own
 * registration, connecting a second adapter and initialising every plugin a
 * second time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../database/factory";
import type { PluginDefinition } from "../../plugins/plugin-context";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { getService, isServicesRegistered, registerServices, shutdownServices } =
  await import("../register");

afterEach(async () => {
  await shutdownServices();
  vi.unstubAllEnvs();
});

describe("concurrent registration", () => {
  it("runs once, and both callers see it complete", async () => {
    vi.stubEnv("DB_DIALECT", "sqlite");
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    let inits = 0;
    const plugin = {
      name: "@acme/counted",
      version: "1.0.0",
      nextly: "*",
      init: () => {
        inits += 1;
      },
    } as unknown as PluginDefinition;
    const config = {
      adapter,
      plugins: [plugin],
    } as unknown as Parameters<typeof registerServices>[0];

    await expect(
      Promise.all([registerServices(config), registerServices(config)])
    ).resolves.toEqual([undefined, undefined]);
    expect(inits).toBe(1);
  });

  it("after a failed attempt, every waiter shares one retry that its release cannot undo", async () => {
    vi.stubEnv("DB_DIALECT", "sqlite");
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    let inits = 0;
    const plugin = {
      name: "@acme/slow-destroy",
      version: "1.0.0",
      nextly: "*",
      init: () => {
        inits += 1;
      },
      // A teardown that takes time, so the failed attempt is still releasing
      // when its waiters wake.
      destroy: () => new Promise<void>(done => setTimeout(done, 100)),
    } as unknown as PluginDefinition;
    // The first attempt fails after its plugins initialised, a failure that
    // records no refusal, so the next attempt is allowed to succeed. The
    // logger is the hook for it: registration logs once plugins are running.
    let failed = false;
    const failOnce = (message: string): void => {
      if (!failed && message.startsWith("Input sanitization hook")) {
        failed = true;
        throw new Error("registration fails after plugin init");
      }
    };
    const config = {
      adapter,
      plugins: [plugin],
      logger: {
        info: failOnce,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    } as unknown as Parameters<typeof registerServices>[0];

    const outcomes = await Promise.allSettled([
      registerServices(config),
      registerServices(config),
      registerServices(config),
    ]);

    // The first caller's attempt fails; the two callers waiting on it share a
    // single retry, which succeeds, rather than each starting its own.
    expect(outcomes.map(o => o.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(inits).toBe(2);
    // The failed attempt's release finished before the retry began, so it
    // did not clear the container the retry populated.
    expect(isServicesRegistered()).toBe(true);
    expect(() => getService("collectionsHandler")).not.toThrow();
  });
});
