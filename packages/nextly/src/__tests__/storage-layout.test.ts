/**
 * A CLI child a test starts runs per-language storage, as every installation does, unless its test
 * file runs on the earlier layout and hands it the test-only preload (`childLayoutArgs`). Started
 * without the preload, a child is per-language whatever the parent's layout: the preload, not
 * anything the child inherits, is what moves it. The control starts one with the preload.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LOCALISATION_DATA_STEPS,
  MIGRATE_DATA_STEPS,
} from "../cli/commands/upgrade-steps";

import { childLayoutArgs } from "./storage-layout";

const TSX = pathToFileURL(
  join(
    dirname(createRequire(import.meta.url).resolve("tsx/package.json")),
    "dist/loader.mjs"
  )
).href;
const STEPS = pathToFileURL(
  new URL("../cli/commands/upgrade-steps/index.ts", import.meta.url).pathname
).href;
const STORAGE = pathToFileURL(
  new URL("../domains/i18n/per-language-storage.ts", import.meta.url).pathname
).href;

/** What a child started with `preload` prints of `script`, run as a module. */
function childSays(preload: string[], script: string): string {
  const result = spawnSync(
    process.execPath,
    ["--import", TSX, ...preload, "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 60_000 }
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

/** Whether a child started with `preload` keeps every translatable field per language. */
function childPerLanguage(preload: string[]): string {
  return childSays(
    preload,
    `const m = await import(${JSON.stringify(STORAGE)}); process.stdout.write(String(m.perLanguageStorageEnabled()));`
  );
}

/** Whether a child started with `preload` runs every localisation step in `nextly migrate`. */
function childRunsLocalisationSteps(preload: string[]): string {
  return childSays(
    preload,
    `const m = await import(${JSON.stringify(STEPS)}); process.stdout.write(String(m.LOCALISATION_DATA_STEPS.length > 0 && m.LOCALISATION_DATA_STEPS.every(step => m.MIGRATE_DATA_STEPS.includes(step))));`
  );
}

describe("a CLI child a test starts", () => {
  it("keeps every translatable field per language when started without the preload", () => {
    expect(childPerLanguage([])).toBe("true");
  });

  // The control: this file runs on the earlier layout, so its children are handed the preload,
  // which is what puts them on it.
  it("is put on the earlier layout by the preload alone", () => {
    expect(childLayoutArgs()).toHaveLength(2);
    expect(childPerLanguage(childLayoutArgs())).toBe("false");
  });

  it("runs every localisation step in `nextly migrate` when started without the preload", () => {
    expect(childRunsLocalisationSteps([])).toBe("true");
  });

  // The control: the preload is what takes them out of a child's `nextly migrate`.
  it("runs `nextly migrate` without the localisation steps when handed the preload", () => {
    expect(childRunsLocalisationSteps(childLayoutArgs())).toBe("false");
  });
});

// This file runs on the earlier layout, so the `nextly migrate` it reads runs as an older suite's
// did on dev, without the localisation steps (`migrateDataStepsView`).
describe("`nextly migrate`'s data steps in a file on the earlier layout", () => {
  it("leave out every localisation step and keep the others", () => {
    expect(LOCALISATION_DATA_STEPS.length).toBeGreaterThan(0);
    for (const step of LOCALISATION_DATA_STEPS) {
      expect(MIGRATE_DATA_STEPS).not.toContain(step);
    }
    expect(MIGRATE_DATA_STEPS.length).toBeGreaterThan(0);
  });
});
