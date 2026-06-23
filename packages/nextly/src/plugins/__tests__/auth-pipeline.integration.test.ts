/**
 * Integration: the auth pipeline (D71) is assembled from a booted plugin's
 * `contributes.auth`. Boots a real Nextly (in-memory SQLite) with a plugin that
 * contributes an `afterAuthenticate` hook + a challenge definition, then builds
 * AuthRouterDeps through the real deps-bridge and asserts the registries were
 * populated and the built-in password strategy runs last.
 */
import { afterEach, describe, expect, it } from "vitest";

import { buildAuthRouterDeps } from "../../auth/handlers/deps-bridge";
import type { AuthUserId } from "../../types/auth";
import type { PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const authPlugin: PluginDefinition = {
  name: "@test/auth-2fa",
  version: "0.0.0",
  nextly: ">=0.0.1",
  contributes: {
    auth: {
      hooks: {
        afterAuthenticate: user =>
          user.email === "2fa@x.c"
            ? { challenge: { id: "test-totp", userId: user.id } }
            : user,
      },
      challenges: [
        {
          id: "test-totp",
          resolve: async ({ response }) =>
            response.code === "999" ? { ok: true } : { ok: false },
        },
      ],
    },
  },
};

describe("auth pipeline assembly from contributes.auth (D71)", () => {
  it("collects the plugin's hooks + challenges and appends the password strategy", async () => {
    handle = await createTestNextly({ plugins: [authPlugin] });
    const deps = buildAuthRouterDeps(
      handle.getService as unknown as (name: string) => unknown
    );

    // Built-in password strategy is always present and last.
    expect(deps.authStrategies.length).toBeGreaterThanOrEqual(1);
    expect(deps.authStrategies[deps.authStrategies.length - 1].name).toBe(
      "password"
    );

    // The plugin's challenge definition was registered.
    expect(deps.challengeRegistry.has("test-totp")).toBe(true);

    // The plugin's afterAuthenticate hook participates: a matching user is
    // challenged; a non-matching user passes through unchanged.
    const challenged = await deps.authHooks.runAfterAuthenticate(
      { id: "u1" as AuthUserId, email: "2fa@x.c" },
      deps.pluginCtx
    );
    expect("challenge" in challenged).toBe(true);

    const passed = await deps.authHooks.runAfterAuthenticate(
      { id: "u2" as AuthUserId, email: "other@x.c" },
      deps.pluginCtx
    );
    expect("challenge" in passed).toBe(false);

    // The registered challenge resolves correctly through the registry.
    expect(
      await deps.challengeRegistry.resolve(
        "test-totp",
        { userId: "u1", response: { code: "999" } },
        deps.pluginCtx
      )
    ).toEqual({ ok: true });
  });

  it("with no auth plugin: empty hooks/challenges, password-only strategies", async () => {
    handle = await createTestNextly({});
    const deps = buildAuthRouterDeps(
      handle.getService as unknown as (name: string) => unknown
    );
    expect(deps.authHooks.isEmpty).toBe(true);
    expect(deps.challengeRegistry.has("test-totp")).toBe(false);
    expect(deps.authStrategies).toHaveLength(1);
    expect(deps.authStrategies[0].name).toBe("password");
  });
});
