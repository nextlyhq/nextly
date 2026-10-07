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

import type { NextlyServiceConfig } from "../../di/register";
import { NextlyError } from "../../errors/nextly-error";
import { buildServiceConfig } from "../../init/build-service-config";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { sanitizeConfig } from "../../shared/types/config";

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

/** The service config an app with `plugins` that lists `rawSql` boots from. */
function serviceConfig(
  plugins: PluginDefinition[],
  rawSql: string[]
): NextlyServiceConfig {
  return buildServiceConfig({
    config: sanitizeConfig({ plugins }),
    pluginConsent: { rawSql },
  });
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

    await resolveBootPlugins(serviceConfig([plugin], ["@test/other"]));

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

    const refused = await refusal(serviceConfig([plugin], []));

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

    const resolved = await resolveBootPlugins(
      serviceConfig([plugin], ["@acme/reports"])
    );

    expect(named(resolved.plugins, "@acme/reports").capabilities).toEqual(
      RAW_SQL
    );
  });
});

/**
 * A plugin whose transformer adds its name to `db.rawSqlPlugins` by
 * replacing the list when it is not listed, and declares rawSql on its own
 * entry once it is: harmless in one boot, a grant in the next if the list it
 * replaced was the app's.
 */
const selfListing: PluginDefinition = {
  name: "@evil/p",
  version: "1.0.0",
  nextly: "*",
  setup: config => {
    const db = config.db as unknown as { rawSqlPlugins: readonly string[] };
    if (!db.rawSqlPlugins.includes("@evil/p")) {
      db.rawSqlPlugins = [...db.rawSqlPlugins, "@evil/p"];
      return config;
    }
    return {
      ...config,
      plugins: (config.plugins ?? []).map(entry =>
        entry.name === "@evil/p" ? { ...entry, capabilities: RAW_SQL } : entry
      ),
    };
  },
};

describe("a second boot from the same app config", () => {
  it("does not grant what a transformer wrote in the first", async () => {
    // A `getNextly` retry after a failed boot, a re-boot from the stored
    // config, and the dev server registering again all build the service
    // config afresh from the one sanitized app config.
    const appConfig = sanitizeConfig({ plugins: [selfListing] });

    const first = await resolveBootPlugins(
      buildServiceConfig({ config: appConfig })
    );
    const second = await resolveBootPlugins(
      buildServiceConfig({ config: appConfig })
    );

    expect(named(first.plugins, "@evil/p").capabilities).toBeUndefined();
    expect(named(second.plugins, "@evil/p").capabilities).toBeUndefined();
    expect(appConfig.db.rawSqlPlugins).toEqual([]);
  });

  it("refuses a transformer that pushes onto the app's list", async () => {
    const pushing: PluginDefinition = {
      ...selfListing,
      setup: config => {
        (
          config.db as unknown as { rawSqlPlugins: string[] }
        ).rawSqlPlugins.push("@evil/p");
        return config;
      },
    };
    const appConfig = sanitizeConfig({ plugins: [pushing] });

    await expect(
      resolveBootPlugins(buildServiceConfig({ config: appConfig }))
    ).rejects.toThrow('Plugin "@evil/p" setup transformer failed');
    expect(appConfig.db.rawSqlPlugins).toEqual([]);
  });
});
