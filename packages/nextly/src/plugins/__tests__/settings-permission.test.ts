import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { collectCustomPermissions } from "../permissions/collect-permissions";
import type { PluginDefinition } from "../plugin-context";
import { assertPluginManifests } from "../resolve";
import { SYSTEM_WRITE_POLICY } from "../../domains/auth/system-write-policy";
import {
  CORE_SETTINGS_PERMISSION,
  assertSettingsPermissionsOwned,
  settingsWritePermission,
} from "../settings-permission";

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

/**
 * The ownership check as the boot runs it: over what the collector keeps from
 * the config, with the Schema Builder's entity slugs beside it.
 */
function ownershipVerdict(
  plugins: PluginDefinition[],
  {
    collections = [] as string[],
    builder = [] as string[],
  }: { collections?: string[]; builder?: string[] } = {}
): string | undefined {
  return reasonOf(() =>
    assertSettingsPermissionsOwned(
      plugins,
      collectCustomPermissions(
        { collections: collections.map(slug => ({ slug })) },
        plugins
      ),
      builder
    )
  );
}

describe("a plugin's settings permission at boot", () => {
  it("accepts one of the plugin's own permissions", () => {
    expect(
      ownershipVerdict([
        plugin({
          settings,
          permissions: OWN,
          settingsPermission: "update-pay-settings",
        }),
      ])
    ).toBeUndefined();
  });

  it("refuses a permission the plugin does not declare, naming it", () => {
    // A misspelling: it boots, and then nobody but the super-admin can ever
    // change the settings.
    expect(
      ownershipVerdict([
        plugin({
          settings,
          permissions: OWN,
          settingsPermission: "update-payment-settings",
        }),
      ])
    ).toBe("settings-permission-undeclared");
  });

  it("refuses core's permission named there too", () => {
    // Not the plugin's own: leaving the field out already means it.
    expect(
      ownershipVerdict([
        plugin({
          settings,
          permissions: OWN,
          settingsPermission: "manage-settings",
        }),
      ])
    ).toBe("settings-permission-undeclared");
  });

  it("refuses a publish permission it declares on a collection, which the seeder owns", () => {
    // The plugin declares it, so a check of the manifest passes it — but the
    // collector drops it as the collection's own publish permission, which
    // every content publisher holds.
    expect(
      ownershipVerdict(
        [
          plugin({
            settings,
            permissions: [{ action: "publish", resource: "posts" }],
            settingsPermission: "publish-posts",
          }),
        ],
        { collections: ["posts"] }
      )
    ).toBe("settings-permission-undeclared");
  });

  it("refuses the same on a Schema Builder collection, which only the database knows", () => {
    // The collector cannot see this entity and keeps the declaration; the
    // seeder then hands the row back to the presets.
    expect(
      ownershipVerdict(
        [
          plugin({
            settings,
            permissions: [{ action: "publish", resource: "reports" }],
            settingsPermission: "publish-reports",
          }),
        ],
        { builder: ["reports"] }
      )
    ).toBe("settings-permission-undeclared");
  });

  it("accepts a publish permission on a resource that is no entity", () => {
    // The control for the two above: the action alone is not what refuses
    // them, the entity is.
    expect(
      ownershipVerdict(
        [
          plugin({
            settings,
            permissions: [{ action: "publish", resource: "pay-reports" }],
            settingsPermission: "publish-pay-reports",
          }),
        ],
        { collections: ["posts"], builder: ["reports"] }
      )
    ).toBeUndefined();
  });

  it("refuses another plugin's permission", () => {
    const other = {
      ...plugin({ permissions: OWN }),
      name: "@acme/other",
    } as PluginDefinition;
    // `@acme/other` owns `update-pay-settings`; `@acme/pay` names it.
    expect(
      ownershipVerdict([
        other,
        plugin({ settings, settingsPermission: "update-pay-settings" }),
      ])
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

  it("is core's permission for another plugin", () => {
    expect(settingsWritePermission(plugins, "@acme/other")).toEqual({
      action: "update",
      resource: "settings",
    });
  });
});

describe("core's permission for a plugin's settings", () => {
  it("is the settings change the system write policy names", () => {
    expect(
      SYSTEM_WRITE_POLICY.settings.update.anyOf.map(
        ({ action, resource }) => `${action}-${resource}`
      )
    ).toEqual([CORE_SETTINGS_PERMISSION]);
  });
});
