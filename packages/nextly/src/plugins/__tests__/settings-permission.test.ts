import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";
import { assertPluginManifests } from "../resolve";
import { settingsWritePermission } from "../settings-permission";

function plugin(
  contributes: PluginDefinition["contributes"]
): PluginDefinition {
  return {
    name: "@acme/pay",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes,
  } as PluginDefinition;
}

const OWN = [{ action: "update", resource: "pay-settings" }];
const settings = z.object({ apiKey: z.string().default("") });

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (NextlyError.is(err)) {
      return (err.logContext as { reason?: string }).reason;
    }
    throw err;
  }
  return undefined;
}

describe("a plugin's settings permission at boot", () => {
  it("accepts one of the plugin's own permissions", () => {
    expect(
      reasonOf(() =>
        assertPluginManifests([
          plugin({
            settings,
            permissions: OWN,
            settingsPermission: "update-pay-settings",
          }),
        ])
      )
    ).toBeUndefined();
  });

  it("refuses a permission the plugin does not declare, naming it", () => {
    // A misspelling: it boots, and then nobody but the super-admin can ever
    // change the settings.
    expect(
      reasonOf(() =>
        assertPluginManifests([
          plugin({
            settings,
            permissions: OWN,
            settingsPermission: "update-payment-settings",
          }),
        ])
      )
    ).toBe("settings-permission-undeclared");
  });

  it("refuses core's permission named there too", () => {
    // Not the plugin's own: leaving the field out already means it.
    expect(
      reasonOf(() =>
        assertPluginManifests([
          plugin({
            settings,
            permissions: OWN,
            settingsPermission: "manage-settings",
          }),
        ])
      )
    ).toBe("settings-permission-undeclared");
  });

  it("refuses a settings permission with no settings to guard", () => {
    expect(
      reasonOf(() =>
        assertPluginManifests([
          plugin({
            permissions: OWN,
            settingsPermission: "update-pay-settings",
          }),
        ])
      )
    ).toBe("settings-permission-without-settings");
  });
});

describe("settingsWritePermission", () => {
  const plugins = [
    plugin({
      settings,
      permissions: OWN,
      settingsPermission: "update-pay-settings",
    }),
  ];

  it("is the plugin's declared permission, split as the gate checks it", () => {
    expect(settingsWritePermission(plugins, "@acme/pay")).toEqual({
      action: "update",
      resource: "pay-settings",
    });
  });

  it("is nothing for another plugin, so core's permission applies", () => {
    expect(settingsWritePermission(plugins, "@acme/other")).toBeUndefined();
  });
});
