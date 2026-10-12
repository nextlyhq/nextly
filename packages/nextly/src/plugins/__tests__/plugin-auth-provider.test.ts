/**
 * How often `ctx.auth` builds the auth router's dependencies.
 *
 * Building them assembles every plugin context, the hook registries and the
 * served auth UI. Built on every call, the cheapest question — who is signed
 * in — paid for all of it, on every plugin route that asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompleteLoginDeps } from "../../auth/plugin-auth-api";
import { NextlyError } from "../../errors/nextly-error";
import {
  getPluginAuthApi,
  getPluginAuthApiFor,
  resetPluginAuthApi,
  setPluginAuthDepsResolver,
} from "../plugin-auth-provider";

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";

function resolverSpy() {
  return vi.fn(() => ({ secret: SECRET }) as unknown as CompleteLoginDeps);
}

const anonymous = () => new Request("http://localhost/admin/api/plugins/x/me");

afterEach(() => {
  resetPluginAuthApi();
});

describe("the dependencies behind ctx.auth", () => {
  it("are built once across calls", async () => {
    const resolve = resolverSpy();
    setPluginAuthDepsResolver(resolve);

    await getPluginAuthApi().currentUser(anonymous());
    await getPluginAuthApi().currentUser(anonymous());

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("are rebuilt when a new resolver is registered", async () => {
    // The control: a memo that never cleared would pass the case above and
    // keep serving the hooks of a configuration that has since reloaded.
    const first = resolverSpy();
    setPluginAuthDepsResolver(first);
    await getPluginAuthApi().currentUser(anonymous());

    const second = resolverSpy();
    setPluginAuthDepsResolver(second);
    await getPluginAuthApi().currentUser(anonymous());

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

/**
 * `completeLogin` signs in whichever account a plugin names, so it answers to
 * the plugin's manifest, and the audit trail can say which plugin used it.
 */
describe("ctx.auth.completeLogin for one plugin", () => {
  const declared = {
    name: "@acme/google-auth",
    version: "1.0.0",
    nextly: "*",
    capabilities: { auth: { login: true } },
  };
  // Deps under which the shared path answers a refusal: no such user. That
  // is enough to show the call reached it.
  const refusingDeps = () =>
    ({
      secret: SECRET,
      findUserById: async () => null,
      auditLog: { write: async () => undefined },
      trustProxy: false,
      trustedProxyIps: [],
    }) as unknown as CompleteLoginDeps;
  const login = (strategy: string, plugin: object = declared) =>
    getPluginAuthApiFor(plugin as never).completeLogin("u1", {
      request: anonymous(),
      strategy,
    });

  it("is refused to a plugin that did not declare capabilities.auth.login", async () => {
    setPluginAuthDepsResolver(refusingDeps);
    await expect(
      login("acme-google-auth:google", { ...declared, capabilities: {} })
    ).rejects.toSatisfy(
      (err: unknown) =>
        NextlyError.is(err) &&
        (err.logContext as { reason?: string }).reason ===
          "plugin-login-undeclared"
    );
  });

  it.each(["password", "oauth-google", "other-plugin:google"])(
    "refuses the strategy %s, which does not name the plugin",
    async strategy => {
      setPluginAuthDepsResolver(refusingDeps);
      await expect(login(strategy)).rejects.toSatisfy(
        (err: unknown) => NextlyError.is(err) && err.code === "VALIDATION_ERROR"
      );
    }
  );

  it("reaches the shared login with a declared plugin and its own strategy", async () => {
    setPluginAuthDepsResolver(refusingDeps);
    const res = await login("acme-google-auth:google");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/admin/login?error=signin-failed"
    );
  });
});
