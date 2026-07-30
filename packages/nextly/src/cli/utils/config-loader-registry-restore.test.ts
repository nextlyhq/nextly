/**
 * A failed load leaves the field-type registry as it found it.
 *
 * Loading a config clears the registry and rebuilds it from the new plugin
 * list. Callers that keep running on the previously-loaded config after a bad
 * edit — the `db:sync` watcher, the HMR reload — would otherwise resolve that
 * config's plugin field types against an empty registry, and an unregistered
 * type falls back to a built-in storage primitive, so the schema derived for
 * those fields comes out wrong.
 *
 * The bundler is stubbed because it compiles the config to disk and imports it,
 * which needs a real project tree. Everything under test here runs after that
 * step: the clear, the plugin `setup` calls, and the restore.
 */
import { existsSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFieldTypes,
  getFieldType,
  registerFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import type { PluginFieldType } from "../../plugins/contributions";

import { clearConfigCache, loadConfig } from "./config-loader";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("./config-bundler", () => ({ bundleAndRequire }));

// The loader stats the path before bundling, so the stub has to look real.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

const CONFIG_PATH = "/virtual/nextly.config.ts";

const SURVIVOR: PluginFieldType = {
  type: "star-rating",
  storage: "number",
  adminComponent: "StarRating",
};

const failingPlugin = {
  name: "@t/boom",
  version: "1.0.0",
  nextly: ">=0.0.0",
  setup: () => {
    throw new Error("plugin setup failed");
  },
};

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

describe("loadConfig registry handling on failure", () => {
  it("puts back the types the previous config had registered", async () => {
    // Stands in for the config the process is still serving.
    registerFieldType(SURVIVOR);
    bundleAndRequire.mockResolvedValue({
      mod: { default: { plugins: [failingPlugin] } },
      dependencies: [],
    });

    await expect(
      loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual" })
    ).rejects.toThrow();

    expect(getFieldType("star-rating")).toBeDefined();
  });

  it("leaves the new types in place when the load succeeds", async () => {
    const contributed: PluginFieldType = {
      type: "color-swatch",
      storage: "text",
      adminComponent: "ColorSwatch",
    };
    bundleAndRequire.mockResolvedValue({
      mod: {
        default: {
          plugins: [
            {
              name: "@t/ok",
              version: "1.0.0",
              nextly: ">=0.0.0",
              contributes: { fieldTypes: [contributed] },
            },
          ],
        },
      },
      dependencies: [],
    });

    await loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual" });

    // The restore must be reachable only from the failure path: putting the
    // previous set back after a good load would undo the rebuild.
    expect(getFieldType("color-swatch")).toBeDefined();
  });
});
