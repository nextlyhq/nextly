// Each configuration this package exports still loads under the ESLint it
// declares, with the plugins it names. Nothing in this repository lints with
// it any more (the repository lints with oxlint), so without this a renamed
// plugin export or a rule dropped upstream would go unnoticed until someone
// next extended it.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { config as base } from "./base.js";
import { designTokensConfig } from "./design-tokens.js";
import { nextJsConfig } from "./next.js";
import { config as reactInternal } from "./react-internal.js";

const cwd = dirname(fileURLToPath(import.meta.url));

/** The rules ESLint resolves for `file` under `config`, as it would when linting it. */
async function rulesFor(config, file) {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: config,
  });
  return (await eslint.calculateConfigForFile(file)).rules;
}

describe("the shared configurations", () => {
  it.each([
    [
      "base",
      base,
      "src/a.ts",
      [
        "turbo/no-undeclared-env-vars",
        "@typescript-eslint/no-floating-promises",
      ],
    ],
    [
      "react-internal",
      reactInternal,
      "src/a.tsx",
      ["react-hooks/rules-of-hooks", "react/jsx-key"],
    ],
    [
      "next-js",
      nextJsConfig,
      "src/a.tsx",
      ["@next/next/no-html-link-for-pages"],
    ],
    [
      "design-tokens",
      designTokensConfig(["src/**/*.tsx"]),
      "src/a.tsx",
      ["@nextlyhq/no-hardcoded-colors", "@nextlyhq/no-palette-classes"],
    ],
  ])(
    "%s loads, and turns on a rule from each plugin it names",
    async (_name, config, file, expected) => {
      const rules = await rulesFor(config, file);
      for (const rule of expected) {
        // ESLint normalises a rule's setting to [severity, ...options]; 0 is off.
        expect(rules[rule]?.[0], rule).toBeGreaterThan(0);
      }
    }
  );
});
