import { describe, it, expect } from "vitest";

import type { PluginDefinition } from "../../../plugins/plugin-context";
import { aggregateAuthUi, handleAuthUi, type AuthUiMeta } from "../auth-ui";

const pluginWith = (
  ui: NonNullable<NonNullable<PluginDefinition["contributes"]>["auth"]>["ui"]
): PluginDefinition =>
  ({
    name: `@t/${Math.abs(JSON.stringify(ui).length)}`,
    version: "0.0.0",
    nextly: ">=0.0.1",
    contributes: { auth: { ui } },
  }) as PluginDefinition;

describe("aggregateAuthUi (D57)", () => {
  it("concats providers, merges challengeViews, collects slots into arrays", () => {
    const meta = aggregateAuthUi([
      pluginWith({
        providers: [{ strategy: "oauth-google", label: "Google" }],
        challengeViews: { totp: "@a/admin#Totp" },
        slots: { afterForm: "@a/admin#Legal" },
      }),
      pluginWith({
        providers: [{ strategy: "oauth-github", label: "GitHub" }],
        challengeViews: { sms: "@b/admin#Sms" },
        slots: { afterForm: "@b/admin#Promo", branding: "@b/admin#Logo" },
      }),
    ]);
    expect(meta.providers.map(p => p.strategy)).toEqual([
      "oauth-google",
      "oauth-github",
    ]);
    expect(meta.challengeViews).toEqual({
      totp: "@a/admin#Totp",
      sms: "@b/admin#Sms",
    });
    expect(meta.slots.afterForm).toEqual(["@a/admin#Legal", "@b/admin#Promo"]);
    expect(meta.slots.branding).toEqual(["@b/admin#Logo"]);
    expect(meta.slots.beforeForm).toEqual([]);
  });

  it("returns an empty shape when no plugin contributes auth.ui", () => {
    const meta = aggregateAuthUi([]);
    expect(meta).toEqual({
      providers: [],
      challengeViews: {},
      slots: { beforeForm: [], afterForm: [], branding: [] },
    });
  });

  it("handleAuthUi serves the aggregated meta as public JSON", async () => {
    const authUi: AuthUiMeta = {
      providers: [{ strategy: "oauth-google", label: "Google" }],
      challengeViews: { totp: "@a/admin#Totp" },
      slots: { beforeForm: [], afterForm: [], branding: [] },
    };
    const res = handleAuthUi(new Request("http://x/api/auth/ui"), { authUi });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(authUi);
  });
});

describe("a disabled plugin contributes no auth UI", () => {
  const disabled = (
    ui: NonNullable<NonNullable<PluginDefinition["contributes"]>["auth"]>["ui"]
  ): PluginDefinition =>
    ({ ...pluginWith(ui), name: "@t/off", enabled: false }) as PluginDefinition;

  it("publishes nothing from it", () => {
    // Route and runtime registration skip a disabled plugin, so its provider
    // button pointed at a start route that was never registered.
    const meta = aggregateAuthUi([
      disabled({
        providers: [{ strategy: "oauth-off", label: "Off" }],
        challengeViews: { totp: "@off/admin#Totp" },
        slots: { branding: "@off/admin#Logo" },
      }),
    ]);

    expect(meta.providers).toEqual([]);
    expect(meta.challengeViews).toEqual({});
    expect(meta.slots.branding).toEqual([]);
  });

  it("cannot overwrite an ENABLED plugin's challenge view", () => {
    // The ordering case, and the one with teeth: the disabled plugin is last,
    // so `Object.assign` would have replaced a view that IS served with one
    // that is not.
    const meta = aggregateAuthUi([
      pluginWith({ challengeViews: { totp: "@on/admin#Totp" } }),
      disabled({ challengeViews: { totp: "@off/admin#Totp" } }),
    ]);

    expect(meta.challengeViews).toEqual({ totp: "@on/admin#Totp" });
  });

  it("still publishes an ENABLED plugin's UI", () => {
    // The control: skipping everything would satisfy both tests above while
    // emptying the login page.
    const meta = aggregateAuthUi([
      pluginWith({ providers: [{ strategy: "oauth-on", label: "On" }] }),
    ]);
    expect(meta.providers.map(p => p.strategy)).toEqual(["oauth-on"]);
  });
});
