/**
 * A plugin's auth contributions receive the OWNING plugin's context.
 *
 * The registries pass one context to whatever they invoke; hooks and
 * challenges reading their own settings, fetch allowlist, audit prefix, or
 * self through a system context threw or misattributed — the surfaces are
 * per-plugin, and the binding at registration is what gives each
 * contribution its own.
 */
import { describe, expect, it } from "vitest";

import type { PluginContext } from "../../../plugins/plugin-context";

import { bindChallengeToContext, bindHooksToContext } from "../deps-bridge";

const own = { self: { name: "@a/totp" } } as unknown as PluginContext;
const system = { self: { name: "" } } as unknown as PluginContext;

describe("bindHooksToContext", () => {
  it("hands the OWNING context to each phase, replacing the registry's", async () => {
    const seen: unknown[] = [];
    const hooks = {
      beforeLogin: async (_input: unknown, ctx: PluginContext) => {
        seen.push((ctx as { self: { name: string } }).self.name);
      },
      afterAuthenticate: async (user: unknown, ctx: PluginContext) => {
        seen.push((ctx as { self: { name: string } }).self.name);
        return user;
      },
    };

    const bound = bindHooksToContext(hooks as never, own);
    // The registry would pass ITS context; the wrapper must swap it.
    await bound.beforeLogin?.({} as never, system);
    await bound.afterAuthenticate?.({ id: "u1" } as never, system);

    expect(seen).toEqual(["@a/totp", "@a/totp"]);
  });

  it("keeps a phase's RETURN value intact for the registry's semantics", async () => {
    const bound = bindHooksToContext(
      {
        afterAuthenticate: async (user: unknown, _ctx: PluginContext) => ({
          challenge: { id: "totp", userId: "u1" },
        }),
      },
      own
    );
    const result = await bound.afterAuthenticate?.(
      { id: "u1" } as never,
      system
    );
    expect(result).toEqual({
      challenge: { id: "totp", userId: "u1" },
    });
  });
});

describe("bindChallengeToContext", () => {
  it("resolves with the OWNING context", async () => {
    let received: string | undefined;
    const def = {
      id: "totp",
      resolve: async (
        _args: { userId: string; response: Record<string, unknown> },
        ctx: PluginContext
      ) => {
        received = (ctx as { self: { name: string } }).self.name;
        return { ok: true } as const;
      },
    };

    const bound = bindChallengeToContext(def, own);
    const verdict = await bound.resolve({ userId: "u1", response: {} }, system);

    expect(verdict).toEqual({ ok: true });
    expect(received).toBe("@a/totp");
  });
});
