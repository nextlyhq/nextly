/**
 * The CLI folds plugin contributions with the configuration's per-language storage choice
 * already published, as the boot does.
 *
 * A transform of another plugin's entity is judged by where each field keeps its values, and
 * under `experimental.perLanguageStorage` that is per language for an untranslated entity too.
 * Folded before the choice was published, a command in a fresh process judged as if the setting
 * were off, and accepted a transform the site refuses.
 *
 * The bundler is stubbed, as in `config-loader-transformed-plugins.test.ts`: everything under
 * test runs after it.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetPerLanguageStorage } from "../../domains/i18n/per-language-storage";
import { NextlyError } from "../../errors/nextly-error";

import { clearConfigCache, loadConfig } from "./config-loader";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("./config-bundler", () => ({ bundleAndRequire }));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

const CONFIG_PATH = resolve("/virtual/nextly.config.ts");

/** `shop`, owning `orders` and its untranslated `title` field. */
const shop = {
  name: "shop",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      { slug: "orders", fields: [{ name: "title", type: "text" }] },
    ],
  },
};

/** `reviews`, marking `shop`'s `title` shared, which moves its values under the setting. */
const reviews = {
  name: "reviews",
  version: "1.0.0",
  nextly: ">=0.0.0",
  dependsOn: { shop: "*" },
  contributes: {
    transforms: [
      {
        target: "orders",
        transform: (entity: { fields: Record<string, unknown>[] }) => ({
          ...entity,
          fields: entity.fields.map(field =>
            field.name === "title" ? { ...field, localized: false } : field
          ),
        }),
      },
    ],
  },
};

beforeEach(() => {
  vi.mocked(existsSync).mockImplementation(path => path === CONFIG_PATH);
  clearConfigCache();
  // A fresh process: nothing has chosen the layout yet.
  _resetPerLanguageStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
  bundleAndRequire.mockReset();
  clearConfigCache();
  _resetPerLanguageStorage();
});

describe("a transform of another plugin's entity, in the CLI under per-language storage", () => {
  it("is refused when it moves the owner's field out of its per-language table", async () => {
    bundleAndRequire.mockResolvedValue({
      mod: {
        default: {
          experimental: { perLanguageStorage: true },
          plugins: [shop, reviews],
        },
      },
      dependencies: [],
    });

    await expect(
      loadConfig({ configPath: CONFIG_PATH, cwd: "/virtual" })
    ).rejects.toSatisfy(
      (err: unknown) =>
        NextlyError.is(err) &&
        JSON.stringify(err.publicData).includes("TRANSFORM_FIELD_PROTECTED")
    );
  });
});
