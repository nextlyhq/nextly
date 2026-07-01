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
