/**
 * The booted plugin list is metadata ABOUT a running runtime, so it may only be
 * published once that runtime exists.
 *
 * `/admin-meta` deliberately bypasses service initialization, so nothing
 * downstream re-checks it. Published while registration was still in progress,
 * a failure in adapter connection, schema synchronization or plugin init would
 * leave the endpoint reporting a plugin's routes as mounted for a boot that
 * never mounted them, with no later pass to correct the claim.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginDefinition } from "../../plugins/plugin-context";

const setHandlerPlugins = vi.fn();

vi.mock("../../route-handler/auth-handler", () => ({
  setHandlerPlugins: (plugins: unknown) => setHandlerPlugins(plugins),
}));

const { registerServices } = await import("../register");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishing the booted plugin list", () => {
  /**
   * An adapter that cannot connect fails the registration partway. The exact
   * failure does not matter — what matters is that boot did not reach the end,
   * so nothing may yet claim the plugins are running.
   */
  it("does not publish when registration fails", async () => {
    // Fails at `adapter.getDrizzle()`, which is PAST the point the list used
    // to be published from and short of the end of registration — so the test
    // reaches the mechanism rather than tripping over an earlier validation.
    // `nextly: "*"` is load-bearing for that: without it the plugin is rejected
    // by `assertPluginFieldDeclarations` before boot gets anywhere near here,
    // and the assertion below passes for the wrong reason.
    const failing = { connect: () => undefined };

    await expect(
      registerServices({
        adapter: failing,
        plugins: [
          { name: "@acme/p", version: "1.0.0", nextly: "*" },
        ] as unknown as PluginDefinition[],
      } as unknown as Parameters<typeof registerServices>[0])
    ).rejects.toThrow();

    expect(setHandlerPlugins).not.toHaveBeenCalled();
  });
});
