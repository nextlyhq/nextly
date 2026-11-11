/**
 * The CLI's config load judges a plugin field type's declared settings as the
 * server's boot does. `nextly migrate`, `db:sync` and the development reload
 * all load through here rather than through the boot's registration, so a
 * malformed declaration must be refused here too, not only at the next full
 * start. And a refused load must leave the field types already registered in
 * place, since the reload keeps serving the config it had.
 *
 * The bundler is stubbed because it compiles the config to disk and imports it,
 * which needs a real project tree; the check runs after that step.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFieldTypes,
  getFieldType,
  registerFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginFieldType } from "../../plugins/contributions";

import { clearConfigCache, loadConfig } from "./config-loader";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("./config-bundler", () => ({ bundleAndRequire }));

// The loader stats the path before bundling, so the stub has to look real.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

// Resolved, as the loader resolves `configPath` against `cwd`.
const CONFIG_PATH = resolve("/virtual/nextly.config.ts");

/** A config whose one plugin contributes a type declaring these settings. */
function load(settings: unknown) {
  bundleAndRequire.mockResolvedValue({
    mod: {
      default: {
        plugins: [
          {
            name: "@acme/rating",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: {
              fieldTypes: [
                {
                  type: "star-rating",
                  storage: "number",
                  component: "@acme/rating/admin#Stars",
                  settings,
                },
              ],
            },
          },
        ],
      },
    },
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

describe("loadConfig and a plugin field type's declared settings", () => {
  it("loads a well-formed list and registers the type", async () => {
    await load([{ key: "max", label: "Most stars", control: "number" }]);
    expect(getFieldType("star-rating")).toBeDefined();
  });

  it("refuses a malformed list, naming the plugin and the type", async () => {
    await expect(
      load([{ key: "shape", label: "Shape", control: "select", options: [] }])
    ).rejects.toSatisfy(
      (err: unknown) =>
        NextlyError.is(err) &&
        err.code === "CONFIGURATION_ERROR" &&
        err.logContext?.plugin === "@acme/rating" &&
        err.logContext?.fieldType === "star-rating"
    );
  });

  it("leaves the previously registered types in place when it refuses", async () => {
    // Stands in for the config a reload keeps serving.
    const serving: PluginFieldType = {
      type: "color-swatch",
      storage: "text",
      component: "@acme/swatch/admin#Swatch",
    };
    registerFieldType(serving);

    await expect(
      load([
        { key: "max", label: "Most stars", control: "number" },
        { key: "max", label: "Most hearts", control: "number" },
      ])
    ).rejects.toThrow();

    expect(getFieldType("color-swatch")).toBeDefined();
    expect(getFieldType("star-rating")).toBeUndefined();
  });
});
