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

describe("a transformer and a listed name", () => {
  it("refuses a plugin renamed onto a listed name", async () => {
    // The app once installed @acme/reports and still lists it. A different
    // plugin renames itself to that name and declares rawSql.
    const renaming: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => ({
        ...config,
        plugins: (config.plugins ?? []).map(entry =>
          entry.name === "@evil/p"
            ? { ...entry, name: "@acme/reports", capabilities: RAW_SQL }
            : entry
        ),
      }),
    };

    const refused = await refusal(serviceConfig([renaming], ["@acme/reports"]));

    expect(refused?.logContext).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/reports",
    });
    expect(refused?.logMessage).toContain(
      'A setup transformer added plugin "@acme/reports", or renamed another plugin to that name'
    );
  });

  it("refuses rawSql a transformer adds to a listed plugin", async () => {
    // Listed, but its own manifest never declared rawSql: the app reviewed a
    // plugin without it.
    const listed: PluginDefinition = {
      name: "@acme/reports",
      version: "1.0.0",
      nextly: "*",
    };
    const granting: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => ({
        ...config,
        plugins: (config.plugins ?? []).map(entry =>
          entry.name === "@acme/reports"
            ? { ...entry, capabilities: RAW_SQL }
            : entry
        ),
      }),
    };

    const refused = await refusal(
      serviceConfig([listed, granting], ["@acme/reports"])
    );

    expect(refused?.logContext).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/reports",
    });
    expect(refused?.logMessage).toContain(
      'added capabilities.db.rawSql to plugin "@acme/reports", whose own manifest does not declare it'
    );
  });
});

describe("a listed name that matches no configured plugin", () => {
  /** A logger that records its warnings. */
  function recording() {
    const warn = vi.fn();
    return {
      warn,
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    };
  }

  const reports: PluginDefinition = {
    name: "@acme/reports",
    version: "1.0.0",
    nextly: "*",
    capabilities: RAW_SQL,
  };

  it("warns once, naming it, and boots", async () => {
    const { warn, logger } = recording();

    const resolved = await resolveBootPlugins({
      ...serviceConfig([reports], ["@acme/reports", "@acme/removed"]),
      logger,
    });

    expect(named(resolved.plugins, "@acme/reports")).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'db.rawSqlPlugins lists "@acme/removed", which matches no configured plugin, so it grants nothing. Remove it, or correct the name if it is misspelt.'
    );
  });

  it("says nothing when every listed name is configured", async () => {
    const { warn, logger } = recording();

    await resolveBootPlugins({
      ...serviceConfig([reports], ["@acme/reports"]),
      logger,
    });

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a transformer that edits what it was handed in place", () => {
  it("refuses a plugin pushed onto the list under a listed name", async () => {
    // The app still lists a plugin it removed. A transformer pushes a plugin
    // under that name onto the list it received, and returns that list.
    const pushing: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => {
        config.plugins?.push({
          name: "@acme/removed",
          version: "1.0.0",
          nextly: "*",
          capabilities: RAW_SQL,
        });
        return config;
      },
    };

    const refused = await refusal(serviceConfig([pushing], ["@acme/removed"]));

    expect(refused?.logContext).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/removed",
    });
  });

  it("refuses a plugin renamed in place onto a listed name", async () => {
    const renaming: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => {
        const self = config.plugins?.find(entry => entry.name === "@evil/p");
        if (self) {
          self.name = "@acme/removed";
          self.capabilities = RAW_SQL;
        }
        return config;
      },
    };

    const refused = await refusal(serviceConfig([renaming], ["@acme/removed"]));

    expect(refused?.logContext).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/removed",
    });
  });

  it("refuses rawSql flipped on in place on a listed plugin", async () => {
    const listed: PluginDefinition = {
      name: "@acme/reports",
      version: "1.0.0",
      nextly: "*",
      capabilities: { db: { rawSql: false } },
    };
    const flipping: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => {
        const target = config.plugins?.find(
          entry => entry.name === "@acme/reports"
        );
        const db = target?.capabilities?.db;
        if (db) db.rawSql = true;
        return config;
      },
    };

    const refused = await refusal(
      serviceConfig([listed, flipping], ["@acme/reports"])
    );

    expect(refused?.logContext).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/reports",
    });
    // The edit reached a copy, not the app's own definition.
    expect(listed.capabilities).toEqual({ db: { rawSql: false } });
  });
});

describe("a transformer that keeps a granted name and replaces the code", () => {
  const reports: PluginDefinition = {
    name: "@acme/reports",
    version: "1.0.0",
    nextly: "*",
    capabilities: RAW_SQL,
    init: () => undefined,
  };

  it("refuses a plugin that drops the listed one and renames itself onto it", async () => {
    const swapping: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      init: () => undefined,
      setup: config => {
        const self = config.plugins?.find(entry => entry.name === "@evil/p");
        if (!self) return config;
        self.name = "@acme/reports";
        self.capabilities = RAW_SQL;
        return { ...config, plugins: [self] };
      },
    };

    const refused = await refusal(
      serviceConfig([reports, swapping], ["@acme/reports"])
    );

    expect(refused?.logContext).toMatchObject({
      reason: "plugin-code-replaced-by-setup",
      plugin: "@acme/reports",
      path: "init",
    });
    expect(refused?.logMessage).toContain(
      'A setup transformer changed the code of plugin "@acme/reports" (init)'
    );
  });

  it("refuses the listed plugin with its init replaced", async () => {
    const evilInit = () => undefined;
    const replacing: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => ({
        ...config,
        plugins: (config.plugins ?? []).map(entry =>
          entry.name === "@acme/reports" ? { ...entry, init: evilInit } : entry
        ),
      }),
    };

    const refused = await refusal(
      serviceConfig([reports, replacing], ["@acme/reports"])
    );

    expect(refused?.logContext).toMatchObject({
      reason: "plugin-code-replaced-by-setup",
      plugin: "@acme/reports",
      path: "init",
    });
  });

  it("refuses an auth hook added to the listed plugin's contributes", async () => {
    const hooking: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => {
        const target = config.plugins?.find(
          entry => entry.name === "@acme/reports"
        );
        if (target) {
          target.contributes = {
            auth: { hooks: { afterAuthenticate: user => user } },
          };
        }
        return config;
      },
    };

    const refused = await refusal(
      serviceConfig([reports, hooking], ["@acme/reports"])
    );

    expect(refused?.logContext).toMatchObject({
      reason: "plugin-code-replaced-by-setup",
      plugin: "@acme/reports",
    });
  });

  it("grants the listed plugin a transformer leaves as configured", async () => {
    const spreading: PluginDefinition = {
      name: "@acme/other",
      version: "1.0.0",
      nextly: "*",
      setup: config => ({
        ...config,
        plugins: (config.plugins ?? []).map(entry => ({ ...entry })),
      }),
    };

    const resolved = await resolveBootPlugins(
      serviceConfig([reports, spreading], ["@acme/reports"])
    );

    expect(named(resolved.plugins, "@acme/reports").init).toBe(reports.init);
  });
});
