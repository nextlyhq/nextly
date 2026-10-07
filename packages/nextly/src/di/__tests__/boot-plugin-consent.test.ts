/**
 * The app's raw-SQL grants hold through a boot's `setup` transformers.
 *
 * A transformer is plugin code that runs between the two resolutions of the
 * plugin list, and both resolutions judge `capabilities.db.rawSql` against the
 * app's `db.rawSqlPlugins`. Each test here is a transformer that tries to
 * reach those grants, and each asserts the boot still judges the plugin by
 * the list the app wrote.
 *
 * Asserted on `resolveBootPlugins`, the boot's own resolution phase, so the
 * config a transformer receives is exactly the one the boot hands it.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../../plugins/plugin-context";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { resolveBootPlugins } = await import("../register");

const RAW_SQL = { db: { rawSql: true } } as const;

/** The resolved plugin named `name`, or a failure naming it. */
function named(
  plugins: readonly PluginDefinition[],
  name: string
): PluginDefinition {
  const found = plugins.find(plugin => plugin.name === name);
  if (!found) throw new Error(`no plugin named ${name} was resolved`);
  return found;
}

/** What `resolveBootPlugins` refused with, or undefined when it resolved. */
async function refusal(
  config: NextlyServiceConfig
): Promise<NextlyError | undefined> {
  try {
    await resolveBootPlugins(config);
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  return undefined;
}

describe("a setup transformer and the consent the boot holds", () => {
  it("does not receive the consent", async () => {
    let received: NextlyServiceConfig | undefined;
    const plugin: PluginDefinition = {
      name: "@test/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => {
        received = config;
        return config;
      },
    };

    await resolveBootPlugins({
      plugins: [plugin],
      pluginConsent: { rawSql: ["@test/other"] },
    });

    expect(received).toBeDefined();
    expect(received).not.toHaveProperty("pluginConsent");
  });

  it("cannot list itself by pushing onto the consent it was passed", async () => {
    // The shape of the attack: push its own name onto whatever consent it
    // can reach, then declare rawSql on its own entry.
    const plugin: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => {
        const reached = (config as { pluginConsent?: { rawSql: string[] } })
          .pluginConsent;
        reached?.rawSql.push("@evil/p");
        return {
          ...config,
          plugins: (config.plugins ?? []).map(entry =>
            entry.name === "@evil/p"
              ? { ...entry, capabilities: RAW_SQL }
              : entry
          ),
        };
      },
    };

    const refused = await refusal({
      plugins: [plugin],
      pluginConsent: { rawSql: [] },
    });

    expect(refused?.logContext).toMatchObject({
      reason: "capability-not-listed",
      plugins: ["@evil/p"],
    });
  });

  it("still grants a plugin the app lists and that declares rawSql", async () => {
    const plugin: PluginDefinition = {
      name: "@acme/reports",
      version: "1.0.0",
      nextly: "*",
      capabilities: RAW_SQL,
      setup: config => config,
    };

    const resolved = await resolveBootPlugins({
      plugins: [plugin],
      pluginConsent: { rawSql: ["@acme/reports"] },
    });

    expect(named(resolved.plugins, "@acme/reports").capabilities).toEqual(
      RAW_SQL
    );
  });
});
