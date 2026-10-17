/**
 * The admin's component-map check against a real boot.
 *
 * - The generator and the check read one plugin list. `generate:types`
 *   resolves the config through `loadConfig`, and the check reads the list the
 *   boot resolved. Both must give the same components, including a plugin a
 *   `setup` transformer adds.
 * - A dashboard widget whose component the map lacks refuses the admin in
 *   production, and in development when the running app may not rewrite
 *   generated files. A control passes with the map whole.
 *
 * The config bundler is stubbed, as the loader's own tests stub it:
 * everything under test runs after it. The boot is real (`createTestNextly`);
 * the check's own call to start Nextly is stubbed, since the instance is
 * already booted.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../../init", () => ({ getNextly: vi.fn(async () => ({})) }));
const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("../../../../cli/utils/config-bundler", () => ({ bundleAndRequire }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

import {
  clearConfigCache,
  loadConfig,
} from "../../../../cli/utils/config-loader";
import { NextlyError } from "../../../../errors/nextly-error";
import { componentImportMapEntries } from "../../../../plugins/codegen/component-import-map";
import { definePlugin } from "../../../../plugins/plugin-context";
import type { PluginDefinition } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { checkAdminComponents } from "../component-map-check";
import { adminComponentPlugins } from "../component-map-store";
import { defineWidget } from "../define-widget";

const CONFIG_PATH = resolve("/virtual/nextly.config.ts");

const revenue = defineWidget({
  id: "acme/revenue",
  title: "Revenue",
  description: "Takings per day",
  category: "Shop",
  widths: ["full"],
  width: "full",
  data: async () => ({ total: 1 }),
  display: { component: "@acme/shop/admin#Revenue" },
});

const visits = defineWidget({
  id: "stats/visits",
  title: "Visits",
  description: "Visits per day",
  category: "Stats",
  widths: ["full"],
  width: "full",
  data: async () => ({ total: 1 }),
  display: { component: "@acme/stats/admin#Visits" },
});

/** A plugin a `setup` transformer adds, so only a full resolution sees it. */
const stats = definePlugin({
  name: "@acme/stats",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: { dashboard: { widgets: [visits] } },
});

const shop = definePlugin({
  name: "@acme/shop",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: { dashboard: { widgets: [revenue] } },
  setup: config => ({
    ...config,
    plugins: [...(config.plugins ?? []), stats],
  }),
});

const config = {
  typescript: { outputFile: "./src/types/generated/nextly-types.ts" },
} as unknown as Parameters<typeof checkAdminComponents>[0]["config"];

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  vi.unstubAllEnvs();
  clearConfigCache();
  bundleAndRequire.mockReset();
});

/** The plugins `generate:types` would resolve from a config of `plugins`. */
async function generatorPlugins(
  plugins: PluginDefinition[]
): Promise<PluginDefinition[]> {
  vi.mocked(existsSync).mockImplementation(path => path === CONFIG_PATH);
  bundleAndRequire.mockResolvedValue({
    mod: { default: { plugins } },
    dependencies: [],
  });
  const loaded = await loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual" });
  vi.mocked(existsSync).mockRestore();
  return loaded.config.plugins ?? [];
}

async function refusalOf(run: Promise<void>): Promise<NextlyError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(NextlyError);
    return error as NextlyError;
  }
  throw new Error("expected the admin to be refused");
}

describe("the component map, against a real boot (sqlite)", () => {
  it("lists the same components from the generator's resolution and the boot's", async () => {
    const fromGenerator = componentImportMapEntries(
      await generatorPlugins([shop])
    );
    handle = await createTestNextly({ plugins: [shop] });
    const fromBoot = componentImportMapEntries(adminComponentPlugins() ?? []);
    expect(fromBoot).toEqual(fromGenerator);
    // Both see the plugin the transformer added, not only the declared one.
    expect(fromBoot.map(each => each.widget)).toEqual([
      "acme/revenue",
      "stats/visits",
    ]);
  });

  it("refuses the admin in production over a widget the map lacks, and serves it with the map whole", async () => {
    handle = await createTestNextly({ plugins: [shop] });
    vi.stubEnv("NODE_ENV", "production");
    const refused = await refusalOf(
      checkAdminComponents({
        config,
        registeredComponentPaths: ["@acme/shop/admin#Revenue"],
      })
    );
    expect(refused.code).toBe("NEXTLY_ADMIN_COMPONENT_MAP_STALE");
    expect(refused.logMessage).toContain(
      '- plugin "@acme/stats", widget "stats/visits": `@acme/stats/admin#Visits`'
    );
    await expect(
      checkAdminComponents({
        config,
        registeredComponentPaths: [
          "@acme/shop/admin#Revenue",
          "@acme/stats/admin#Visits",
        ],
      })
    ).resolves.toBe(undefined);
  });

  it("refuses it in development when the app may not rewrite generated files", async () => {
    handle = await createTestNextly({ plugins: [shop] });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTLY_GENERATED_FILES_WRITE", "0");
    const refused = await refusalOf(
      checkAdminComponents({ config, registeredComponentPaths: [] })
    );
    expect(refused.logMessage).toContain(
      "automatic regeneration is off (NEXTLY_GENERATED_FILES_WRITE=0)"
    );
    expect(refused.logMessage).toContain('widget "acme/revenue"');
  });
});
