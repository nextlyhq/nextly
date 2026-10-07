/**
 * A `setup` transformer run by the CLI cannot grant raw SQL to the commands
 * that boot from the config the CLI loaded.
 *
 * The loader runs every transformer, and `nextly plugins install` then boots
 * from the loaded config to run a plugin's `onInstall`. A transformer handed
 * the app's own `db` block could add its name to `db.rawSqlPlugins` there, so
 * the boot that followed, reading consent from that config, granted it. The
 * loader now returns the consent it read before any transformer ran, and the
 * transformers never hold the app's list.
 *
 * The bundler is stubbed, as in `config-loader-transformed-plugins.test.ts`:
 * everything under test runs after it.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearFieldTypes } from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors/nextly-error";
import { buildServiceConfig } from "../../init/build-service-config";
import type { PluginDefinition } from "../../plugins/plugin-context";

import { clearConfigCache, loadConfig } from "./config-loader";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("./config-bundler", () => ({ bundleAndRequire }));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { resolveBootPlugins } = await import("../../di/register");

const CONFIG_PATH = resolve("/virtual/nextly.config.ts");

type Listing = { db: { rawSqlPlugins: string[] }; plugins: PluginDefinition[] };

/**
 * A plugin whose transformer lists itself through `list` when it is not
 * listed, and declares rawSql on its own entry once it is.
 */
function selfListing(list: (config: Listing) => void): PluginDefinition {
  return {
    name: "@evil/p",
    version: "1.0.0",
    nextly: "*",
    setup: config => {
      const listing = config as unknown as Listing;
      if (!listing.db.rawSqlPlugins.includes("@evil/p")) {
        list(listing);
        return config;
      }
      return {
        ...config,
        plugins: (config.plugins ?? []).map(entry =>
          entry.name === "@evil/p"
            ? { ...entry, capabilities: { db: { rawSql: true } } }
            : entry
        ),
      };
    },
  };
}

function load(plugins: PluginDefinition[], rawSqlPlugins: string[] = []) {
  bundleAndRequire.mockResolvedValue({
    mod: { default: { plugins, db: { rawSqlPlugins } } },
    dependencies: [],
  });
  return loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual" });
}

beforeEach(() => {
  vi.mocked(existsSync).mockImplementation(path => path === CONFIG_PATH);
  clearConfigCache();
  clearFieldTypes();
});

afterEach(() => {
  vi.restoreAllMocks();
  bundleAndRequire.mockReset();
  clearConfigCache();
  clearFieldTypes();
});

describe("a CLI-loaded config and a transformer that lists itself", () => {
  it("refuses a transformer that pushes onto the app's list", async () => {
    const caught = await load([
      selfListing(config => config.db.rawSqlPlugins.push("@evil/p")),
    ]).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as NextlyError).logContext).toMatchObject({
      reason: "plugin-setup-transformer-failed",
      pluginName: "@evil/p",
    });
  });

  it("keeps a replaced list out of the loaded config and its consent", async () => {
    const result = await load([
      selfListing(config => {
        config.db.rawSqlPlugins = [...config.db.rawSqlPlugins, "@evil/p"];
      }),
    ]);

    expect(result.config.db.rawSqlPlugins).toEqual([]);
    expect(result.pluginConsent.rawSql).toEqual([]);
  });

  it("boots the lifecycle runner's config without the grant", async () => {
    // What `nextly plugins install` does after loading: build the service
    // config from the loaded config and the loader's consent, and boot.
    const { config, pluginConsent } = await load([
      selfListing(listing => {
        listing.db.rawSqlPlugins = [...listing.db.rawSqlPlugins, "@evil/p"];
      }),
    ]);

    const booted = await resolveBootPlugins(
      buildServiceConfig({ config, pluginConsent })
    );

    const evil = booted.plugins.find(plugin => plugin.name === "@evil/p");
    expect(evil).toBeDefined();
    expect(evil?.capabilities?.db?.rawSql).toBeUndefined();
    expect(config.db.rawSqlPlugins).toEqual([]);
  });
});

describe("a CLI-loaded config and a transformer that renames", () => {
  it("refuses a plugin renamed onto a listed name", async () => {
    const renaming: PluginDefinition = {
      name: "@evil/p",
      version: "1.0.0",
      nextly: "*",
      setup: config => ({
        ...config,
        plugins: (config.plugins ?? []).map(entry =>
          entry.name === "@evil/p"
            ? {
                ...entry,
                name: "@acme/reports",
                capabilities: { db: { rawSql: true } },
              }
            : entry
        ),
      }),
    };

    const caught = await load([renaming], ["@acme/reports"]).catch(
      (error: unknown) => error
    );

    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as NextlyError).logContext).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/reports",
    });
  });
});

describe("a CLI-loaded config and a transformer that edits in place", () => {
  const RAW_SQL = { db: { rawSql: true } };

  /** What `load` refused with, as its log context. */
  async function refusedWith(
    plugins: PluginDefinition[],
    rawSqlPlugins: string[]
  ): Promise<Record<string, unknown> | undefined> {
    const caught = await load(plugins, rawSqlPlugins).catch(
      (error: unknown) => error
    );
    expect(caught).toBeInstanceOf(NextlyError);
    return (caught as NextlyError).logContext;
  }

  it("refuses a plugin pushed onto the list under a listed name", async () => {
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

    expect(await refusedWith([pushing], ["@acme/removed"])).toMatchObject({
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

    expect(await refusedWith([renaming], ["@acme/removed"])).toMatchObject({
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
        const db = config.plugins?.find(entry => entry.name === "@acme/reports")
          ?.capabilities?.db;
        if (db) db.rawSql = true;
        return config;
      },
    };

    expect(
      await refusedWith([listed, flipping], ["@acme/reports"])
    ).toMatchObject({
      reason: "capability-added-by-setup",
      plugin: "@acme/reports",
    });
    expect(listed.capabilities).toEqual({ db: { rawSql: false } });
  });
});
