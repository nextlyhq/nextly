/**
 * The CLI resolves the plugin list a `setup` transformer leaves, as the boot
 * does.
 *
 * A transformer may add a plugin. The boot re-resolves the transformed list in
 * full and folds that list; the CLI checked only slugs and widgets and folded
 * the list from BEFORE the transform, so `nextly migrate`, `build`, `db:sync`
 * and the dev reload accepted a plugin the deployed app refused, and missed
 * the collections and field types an accepted one contributed.
 *
 * The bundler is stubbed, as in `config-loader-registry-restore.test.ts`:
 * everything under test runs after it.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  clearFieldTypes,
  getFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors/nextly-error";

import { clearConfigCache, loadConfig } from "./config-loader";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("./config-bundler", () => ({ bundleAndRequire }));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

// Resolved, as the loader resolves `configPath` against `cwd`: on Windows a
// leading `/` gains the drive letter, and the mocks compare against these.
const CONFIG_PATH = resolve("/virtual/nextly.config.ts");

/** Plugin A, whose `setup` adds `added` to the config's plugins. */
function adding(added: Record<string, unknown>) {
  return {
    name: "@t/a",
    version: "1.0.0",
    nextly: ">=0.0.0",
    setup: (config: { plugins?: unknown[] }) => ({
      ...config,
      plugins: [...(config.plugins ?? []), added],
    }),
  };
}

function load(plugins: unknown[]) {
  bundleAndRequire.mockResolvedValue({
    mod: { default: { plugins } },
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

describe("a plugin a setup transformer adds, in the CLI", () => {
  it("is refused when the boot would refuse it", async () => {
    const incompatible = { name: "@t/b", version: "1.0.0", nextly: ">=99" };

    await expect(load([adding(incompatible)])).rejects.toSatisfy(
      (err: unknown) =>
        NextlyError.is(err) && JSON.stringify(err.logContext).includes("@t/b")
    );
  });

  it("has its collections folded into the config", async () => {
    const withCollection = {
      name: "@t/b",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        collections: [
          { slug: "b-items", fields: [{ name: "title", type: "text" }] },
        ],
      },
    };

    const { config } = await load([adding(withCollection)]);

    expect(config.collections?.map(c => c.slug)).toContain("b-items");
  });

  it("has its field types registered", async () => {
    const withFieldType = {
      name: "@t/b",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        fieldTypes: [
          {
            type: "b-rating",
            storage: "number",
            component: "@t/b/admin#Rating",
          },
        ],
      },
    };

    await load([adding(withFieldType)]);

    expect(getFieldType("b-rating")).toBeDefined();
  });
});

describe("a plugin's settings permission, in the CLI", () => {
  /** A plugin keeping its settings to `settingsPermission`. */
  function paying(settingsPermission: string) {
    return {
      name: "@t/pay",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        settings: z.object({ apiKey: z.string().default("") }),
        permissions: [{ action: "update", resource: "pay-settings" }],
        settingsPermission,
      },
    };
  }

  it("is refused when it is not one the plugin owns, as the boot refuses it", async () => {
    // A command that accepted it would build or migrate an application whose
    // boot then refuses to start.
    await expect(load([paying("update-unowned-settings")])).rejects.toSatisfy(
      (err: unknown) =>
        NextlyError.is(err) &&
        (err.logContext as { reason?: string }).reason ===
          "settings-permission-undeclared"
    );
  });

  it("is accepted when it is one the plugin owns", async () => {
    // The control: a check refusing every settings permission passes the case
    // above.
    await expect(load([paying("update-pay-settings")])).resolves.toBeDefined();
  });
});
