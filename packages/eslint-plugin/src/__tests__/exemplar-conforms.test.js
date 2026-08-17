import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ESLint } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { expect, it } from "vitest";

import plugin from "../index.js";

/**
 * The plugin template is the file every third-party plugin starts from, so it is
 * held to the rules it demonstrates.
 *
 * Checked here rather than through the repository's ESLint run because the root
 * config ignores `templates/**` — those trees have no tsconfig of their own and
 * type-aware linting cannot parse them. That exclusion is correct and it leaves
 * the exemplar ungoverned, which is how it came to contradict its own docblock.
 * These rules need no type information, so they can be applied directly.
 */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
const TEMPLATE_GLOB = "templates/plugin/src/**/*.{ts,tsx}";

async function lintTemplate() {
  // `cwd` is the repository root because ESLint treats a path outside its
  // working directory as ignored, and reports that as "all files are ignored"
  // rather than as zero violations — which would otherwise have read as a pass.
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            ecmaFeatures: { jsx: true },
          },
        },
        plugins: { "@nextlyhq": plugin },
        rules: {
          "@nextlyhq/no-palette-classes": "error",
          "@nextlyhq/no-hardcoded-colors": "error",
          "@nextlyhq/no-static-inline-style": "error",
        },
      },
    ],
  });
  return eslint.lintFiles([TEMPLATE_GLOB]);
}

it("lints a non-empty set of template files", async () => {
  const results = await lintTemplate();
  // Asserted before the verdict below: zero violations across zero files is the
  // same output as a conforming template, so without this the next assertion
  // would pass on a path that stopped resolving.
  expect(results.length).toBeGreaterThan(0);
  expect(results.some(r => r.filePath.endsWith("SettingsPage.tsx"))).toBe(true);
});

it("the plugin exemplar obeys the rules it demonstrates", async () => {
  const results = await lintTemplate();
  const violations = results.flatMap(result =>
    result.messages.map(
      message =>
        `${result.filePath.split("/templates/")[1]}:${message.line}  ${message.ruleId}  ${message.message}`
    )
  );
  expect(violations).toEqual([]);
});
