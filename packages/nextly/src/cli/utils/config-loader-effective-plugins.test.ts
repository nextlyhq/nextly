/**
 * The CLI folds the config with the plugin list the runtime boot uses: the
 * one `setup` transformers produced, resolved again.
 *
 * Folding with the pre-transformer list left a plugin a transformer added out
 * of everything the CLI and the HMR reload compile — its collections were not
 * folded — while the booted app, which re-resolves the transformed list, had
 * them.
 *
 * The bundler is stubbed for the reason `config-loader-registry-restore.test.ts`
 * gives; everything under test runs after it.
 */
import { existsSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache, loadConfig } from "./config-loader";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("./config-bundler", () => ({ bundleAndRequire }));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

const CONFIG_PATH = "/virtual/nextly.config.ts";

/** A plugin a transformer adds: it contributes a collection. */
const added = {
  name: "@t/added",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: { collections: [{ slug: "added-notes", fields: [] }] },
};

/** The plugin whose `setup` adds it. */
const transformer = {
  name: "@t/transformer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  setup: (config: Record<string, unknown>) => ({
    ...config,
    plugins: [...((config.plugins as unknown[]) ?? []), added],
  }),
};

beforeEach(() => {
  vi.mocked(existsSync).mockImplementation(path => path === CONFIG_PATH);
  clearConfigCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  bundleAndRequire.mockReset();
  clearConfigCache();
});

describe("loadConfig with a plugin a setup transformer adds", () => {
  it("folds that plugin's contributions, as the booted app does", async () => {
    bundleAndRequire.mockResolvedValue({
      mod: { default: { plugins: [transformer] } },
      dependencies: [],
    });

    const { config } = await loadConfig({
      configPath: CONFIG_PATH,
      cwd: "/virtual",
    });

    expect(config.plugins?.map(p => p.name)).toEqual([
      "@t/transformer",
      "@t/added",
    ]);
    expect(config.collections?.map(c => c.slug)).toContain("added-notes");
  });
});
