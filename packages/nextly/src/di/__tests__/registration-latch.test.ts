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

const { registerServices, shutdownServices } = await import("../register");

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
});
