/**
 * The loader returns the config as the app wrote it beside the transformed
 * one, and a boot started from it runs each `setup` transformer once.
 *
 * `nextly plugins install` boots the runtime to run a plugin's `onInstall`.
 * It used to boot from the loader's `config`, which already holds every
 * transformer's result, so the boot ran each transformer a second time: one
 * that adds a plugin added it twice, and the boot refused the duplicate.
 *
 * The bundler is stubbed, as in `config-loader-consent.test.ts`: everything
 * under test runs after it.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { clearFieldTypes } from "../../domains/schema/field-types/field-type-registry";
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

/** A plugin whose transformer adds a plugin and a collection. */
const adding: PluginDefinition = {
  name: "@test/a",
  version: "1.0.0",
  nextly: "*",
  setup: config => ({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      { name: "@test/added", version: "1.0.0", nextly: "*" },
    ],
    collections: [...(config.collections ?? []), { slug: "extra", fields: [] }],
  }),
};

it("boots from the app's config with each transformer run once", async () => {
  bundleAndRequire.mockResolvedValue({
    mod: { default: { plugins: [adding] } },
    dependencies: [],
  });

  const { config, appConfig, pluginConsent } = await loadConfig({
    configPath: CONFIG_PATH,
    cwd: "/virtual",
  });
  const booted = await resolveBootPlugins(
    buildServiceConfig({ config: appConfig, pluginConsent })
  );

  // The loaded config holds the transformer's result; the app's does not.
  expect(config.plugins.map(plugin => plugin.name)).toEqual([
    "@test/a",
    "@test/added",
  ]);
  expect(appConfig.plugins.map(plugin => plugin.name)).toEqual(["@test/a"]);
  expect(appConfig.collections).toEqual([]);
  // And the boot from it adds each once.
  expect(booted.config.plugins.map(plugin => plugin.name)).toEqual([
    "@test/a",
    "@test/added",
  ]);
  expect(booted.config.collections?.map(entry => entry.slug)).toEqual([
    "extra",
  ]);
});
