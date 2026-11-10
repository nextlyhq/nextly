/**
 * The auth bridge registers a plugin's `determineUser` hook only from a
 * plugin the boot granted the login grant. `init` runs after the consent
 * rule and can add the hook to its own `contributes`, and the bridge reads
 * those contributions afterwards — so a hook that appears only after boot,
 * on a plugin holding no grant, must not answer `/auth/session`.
 */
import { describe, expect, it, vi } from "vitest";

import { AuthHookRegistry } from "../../pipeline/hooks";
import { bindHooksToContext, determineUserIfGranted } from "../deps-bridge";
import type { PluginGrants } from "../../../plugins/plugin-consent";
import type {
  PluginContext,
  PluginDefinition,
} from "../../../plugins/plugin-context";
import type { AuthHooks } from "../../../auth/pipeline/types";

const noGrant: PluginGrants = { rawSql: [], login: [] };
const grantedFor = (name: string): PluginGrants => ({
  rawSql: [],
  login: [name],
});

/** The plugin's own context, as `bindHooksToContext` swaps in. */
const ownCtx = { __own: true } as unknown as PluginContext;
/** Whatever context the registry hands through; the binding replaces it. */
const registryCtx = { __registry: true } as unknown as PluginContext;

const hooksOf = (plugin: PluginDefinition): AuthHooks =>
  plugin.contributes?.auth?.hooks ?? {};

describe("determineUserIfGranted", () => {
  it("keeps the hook of a plugin the boot granted", () => {
    const hooks: AuthHooks = { determineUser: () => null };
    const plugin = { name: "@acme/granted" } as PluginDefinition;

    expect(
      determineUserIfGranted(hooks, plugin, grantedFor("@acme/granted"))
    ).toBe(hooks);
  });

  it("drops the hook of a plugin holding no grant, keeping the rest", () => {
    const beforeLogin = () => undefined;
    const hooks: AuthHooks = { determineUser: () => null, beforeLogin };
    const plugin = { name: "@test/smuggler" } as PluginDefinition;

    const gated = determineUserIfGranted(hooks, plugin, noGrant);

    expect(gated.determineUser).toBeUndefined();
    // The other auth hooks are ordinary contributions, not login-capability
    // declarations: they bind as before.
    expect(gated.beforeLogin).toBe(beforeLogin);
  });

  it("returns a copy holding no determineUser even when none is visible", () => {
    const beforeLogin = () => undefined;
    const hooks: AuthHooks = { beforeLogin };
    const plugin = { name: "@test/plain" } as PluginDefinition;

    const gated = determineUserIfGranted(hooks, plugin, noGrant);

    // A copy, not the live object: whether a determineUser is visible at the
    // gate's read decides nothing — the binder reads the object again, and
    // the definition an accessor sits on is writable after the boot, so the
    // gate's answer must not be the plugin's own object.
    expect(gated).not.toBe(hooks);
    expect(gated.determineUser).toBeUndefined();
    expect(gated.beforeLogin).toBe(beforeLogin);
  });

  it("pins an accessor's answer: undefined at the gate, a function at the binder", () => {
    // The gate and the binder read the hooks object twice — `determineUser`
    // here, every property again in `bindHooksToContext` — and `init` runs
    // as a method on the (writable) definition after the boot, so an
    // accessor installed there can answer `undefined` for the gate's read
    // and the function for the binder's. Returning the live object when the
    // first read saw nothing let the binder's read register the hook; the
    // gate must answer on a copy the second read cannot change.
    const smuggled = async () => null;
    const hooks: AuthHooks = { beforeLogin: () => undefined };
    let reads = 0;
    Object.defineProperty(hooks, "determineUser", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1
          ? undefined
          : (smuggled as unknown as AuthHooks["determineUser"]);
      },
    });
    const plugin = { name: "@test/accessor" } as PluginDefinition;

    const bound = bindHooksToContext(
      determineUserIfGranted(hooks, plugin, noGrant),
      ownCtx
    );

    expect("determineUser" in bound).toBe(false);
    expect(bound.beforeLogin).toBeTypeOf("function");
  });
});

describe("the bridge's hook registration and the login grant", () => {
  // The bridge binds each plugin's GATED hooks into one registry, and
  // `/auth/session` asks that registry who is signed in. This is that shape:
  // two plugins' gated hooks bound to their own contexts, in one registry,
  // answered by the runner the session handler uses.
  it("routes a session-shaped call only to a granted plugin's hook", async () => {
    const declaredHook = vi.fn(
      async (_request: Request, _ctx: PluginContext) => null
    );
    const smuggledHook = vi.fn(
      async (_request: Request, _ctx: PluginContext) => null
    );
    // Declares the hook in its own manifest, and the app lists it: the boot
    // grants the login grant, so this hook registers.
    const granted = {
      name: "@acme/granted",
      version: "1.0.0",
      nextly: "*",
      contributes: { auth: { hooks: { determineUser: declaredHook } } },
    } as unknown as PluginDefinition;
    // Declares nothing login-capable at boot. Its `init` mutates its own
    // `contributes` to add the hook afterwards — the consent rule has
    // already run by then, so the plugin holds no grant for it.
    const smuggler = {
      name: "@test/smuggler",
      version: "1.0.0",
      nextly: "*",
      contributes: { auth: { hooks: { determineUser: smuggledHook } } },
    } as unknown as PluginDefinition;

    const registry = new AuthHookRegistry();
    for (const plugin of [granted, smuggler]) {
      const grant =
        plugin.name === "@acme/granted" ? grantedFor(plugin.name) : noGrant;
      registry.add(
        bindHooksToContext(
          determineUserIfGranted(hooksOf(plugin), plugin, grant),
          ownCtx
        )
      );
    }

    const answer = await registry.runDetermineUser(
      new Request("http://localhost/admin/api/auth/session"),
      registryCtx
    );

    expect(answer).toBeNull();
    // The control: the granted plugin's hook ran, with its OWN context — so
    // the refusal below is about the grant alone, not a dead registry.
    expect(declaredHook).toHaveBeenCalledTimes(1);
    expect(declaredHook.mock.calls[0]?.[1]).toBe(ownCtx);
    expect(smuggledHook).not.toHaveBeenCalled();
  });
});
