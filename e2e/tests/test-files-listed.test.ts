/**
 * Every file a Playwright config runs is one the import guard reads.
 *
 * `scripts/e2e-specs-take-suite-test.test.mjs` holds each test file to the
 * suite's visible-only `test`, and it runs before the packages specs import
 * are built, so it cannot ask Playwright which files those are: it lists them
 * by Playwright's default `testMatch` (`../test-files.mjs`). This asks each
 * config's own `--list`, where the build exists, and fails on a file the
 * guard's list does not hold. So a config whose `testMatch` or `testIgnore`
 * widens what it runs, or a new config, cannot put a file beyond the guard.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";

import { e2eTestFiles } from "../test-files.mjs";
import { test } from "./support/test";

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(E2E, "..");

/** Every Playwright config in the package, each listed below. */
const CONFIGS = [
  "playwright.config.ts",
  "playwright.dev-reload.config.ts",
  "playwright.multi-instance.config.ts",
  "playwright.production.config.ts",
];

/** The files `config` runs, as Playwright resolves them, as repository paths. */
function listedBy(config: string): string[] {
  const require = createRequire(import.meta.url);
  const cli = path.join(
    path.dirname(require.resolve("@playwright/test/package.json")),
    "cli.js"
  );
  // The main config's whole suite, the dev server's own specs included, and
  // its JSON on stdout rather than in a file the environment names.
  const env: NodeJS.ProcessEnv = { ...process.env, E2E_SERVER: "dev" };
  delete env.E2E_DEV_SPECS_ONLY;
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const listed = execFileSync(
    process.execPath,
    [cli, "test", "--config", config, "--list", "--reporter=json"],
    { cwd: E2E, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 }
  );
  const { config: resolved, suites } = JSON.parse(listed) as {
    config: { rootDir: string };
    suites: { file: string }[];
  };
  return [
    ...new Set(
      suites.map(suite =>
        path
          .relative(REPO_ROOT, path.join(resolved.rootDir, suite.file))
          .split(path.sep)
          .join("/")
      )
    ),
  ];
}

test("names every Playwright config the package has", () => {
  const configs = readdirSync(E2E)
    .filter(name => /^playwright(\..+)?\.config\.ts$/.test(name))
    .sort();
  expect(configs).toEqual(CONFIGS);
});

test("every file a config runs is one the import guard reads", () => {
  const guarded = new Set(e2eTestFiles(REPO_ROOT));
  for (const config of CONFIGS) {
    const files = listedBy(config);
    // Read before judged: a config that listed nothing would pass unread.
    expect(files.length, config).toBeGreaterThan(0);
    expect(
      files.filter(file => !guarded.has(file)),
      `${config} runs files e2e/test-files.mjs does not list`
    ).toEqual([]);
  }
});
