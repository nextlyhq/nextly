import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import plugin from "../index.js";
import { createRuleTester } from "./rule-tester.js";

/**
 * The plugin template is the file every third-party plugin starts from, so it is
 * held to the rules it demonstrates.
 *
 * Checked here rather than through the repository's lint run because the root
 * config ignores `templates/**` — those trees have no tsconfig of their own and
 * type-aware linting cannot parse them. That exclusion is correct and it leaves
 * the exemplar ungoverned, which is how it came to contradict its own docblock.
 * These rules need no type information, so they can be applied directly: each
 * template file is a valid case for each rule it demonstrates, parsed as the
 * TypeScript or TSX its extension names.
 */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
const TEMPLATE_FILES = globSync("templates/plugin/src/**/*.{ts,tsx}", {
  cwd: REPO_ROOT,
}).sort();
const DEMONSTRATED_RULES = [
  "no-palette-classes",
  "no-hardcoded-colors",
  "no-static-inline-style",
];

// Asserted on its own: zero cases is the same output as a conforming template,
// so without this the cases below would all pass on a glob that stopped
// resolving.
it("finds the template files, the admin page among them", () => {
  expect(TEMPLATE_FILES.length).toBeGreaterThan(0);
  expect(TEMPLATE_FILES.some(file => file.endsWith("SettingsPage.tsx"))).toBe(
    true
  );
});

// The language comes from each case's filename, so `.ts` and `.tsx` files are
// parsed as what they are; the tester's own JSX default does not apply.
const ruleTester = createRuleTester({ cwd: REPO_ROOT });

for (const ruleName of DEMONSTRATED_RULES) {
  ruleTester.run(ruleName, plugin.rules[ruleName], {
    valid: TEMPLATE_FILES.map(file => ({
      name: file,
      filename: resolve(REPO_ROOT, file),
      code: readFileSync(resolve(REPO_ROOT, file), "utf8"),
    })),
    invalid: [],
  });
}
