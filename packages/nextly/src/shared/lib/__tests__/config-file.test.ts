/**
 * Where a site's config file is found, pinned case by case, and the loader held to the same
 * answer: the discovery lives in `config-file.ts` so the admin's development check can use it
 * without the loader, and the loader's own lookup must not drift from it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  findNextlyConfig,
  SEARCH_DIRECTORIES,
  SUPPORTED_EXTENSIONS,
} from "../../../cli/utils/config-loader";
import {
  CONFIG_FILE_NAMES,
  CONFIG_SEARCH_DIRS,
  findConfigFile,
} from "../config-file";

const made: string[] = [];
/** A project holding exactly these files, each empty. */
function project(...files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "nextly-config-file-"));
  made.push(root);
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}
afterEach(() => {
  for (const root of made.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("finding a site's config file", () => {
  it.each([
    ["at the project's root", ["nextly.config.ts"], "nextly.config.ts"],
    ["under src/", ["src/nextly.config.ts"], "src/nextly.config.ts"],
    ["under config/", ["config/nextly.config.mjs"], "config/nextly.config.mjs"],
    // The names in order within a folder: TypeScript first.
    [
      "preferring .ts to .mts, .js and .mjs in one folder",
      [
        "nextly.config.mjs",
        "nextly.config.js",
        "nextly.config.mts",
        "nextly.config.ts",
      ],
      "nextly.config.ts",
    ],
    [
      "preferring .mts to .js",
      ["nextly.config.js", "nextly.config.mts"],
      "nextly.config.mts",
    ],
    [
      "preferring .js to .mjs",
      ["nextly.config.mjs", "nextly.config.js"],
      "nextly.config.js",
    ],
    // The folders outside the names: any name at the root wins over every name below it.
    [
      "preferring the root, whatever the name, to src/",
      ["src/nextly.config.ts", "nextly.config.mjs"],
      "nextly.config.mjs",
    ],
    [
      "preferring src/ to config/",
      ["config/nextly.config.ts", "src/nextly.config.js"],
      "src/nextly.config.js",
    ],
  ])("finds it %s", (_where, files, expected) => {
    const root = project(...files);
    expect(findConfigFile(root)).toBe(join(root, expected));
    // The loader answers the same.
    expect(findNextlyConfig(root)).toBe(join(root, expected));
  });

  it("finds none where there is no config file, nor one with another name", () => {
    const root = project("nextly.config.json", "src/app/nextly.config.ts");
    expect(findConfigFile(root)).toBeUndefined();
    expect(findNextlyConfig(root)).toBeUndefined();
  });

  it("publishes the names and folders it searches, as the loader always has", () => {
    expect(CONFIG_FILE_NAMES).toEqual([
      "nextly.config.ts",
      "nextly.config.mts",
      "nextly.config.js",
      "nextly.config.mjs",
    ]);
    expect(CONFIG_SEARCH_DIRS).toEqual([".", "./src", "./config"]);
    expect(SUPPORTED_EXTENSIONS).toEqual(CONFIG_FILE_NAMES);
    expect(SEARCH_DIRECTORIES).toEqual(CONFIG_SEARCH_DIRS);
  });
});
