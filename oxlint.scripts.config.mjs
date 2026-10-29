// The repository's dev-tooling scripts, which oxlint.config.mjs leaves out, and
// the two packages written as plain JavaScript with no TypeScript project:
// eslint-plugin and admin-css. `pnpm lint:scripts` names the directories.
//
// No type information: these sit outside every package's TypeScript project.
// What is asked here needs none, and `no-undef` is why the pass exists: a
// release script once referenced a constant that had been deleted, in a
// command-line block no test enters, and every test passed. `pnpm lint:scripts`
// runs it.
import { defineConfig } from "oxlint";

export default defineConfig({
  categories: { correctness: "off" },
  env: { node: true, es2024: true },
  rules: {
    "constructor-super": "error",
    "for-direction": "error",
    "getter-return": "error",
    "no-async-promise-executor": "error",
    "no-case-declarations": "error",
    "no-class-assign": "error",
    "no-compare-neg-zero": "error",
    "no-cond-assign": "error",
    "no-const-assign": "error",
    "no-constant-binary-expression": "error",
    "no-constant-condition": "error",
    "no-control-regex": "error",
    "no-debugger": "error",
    "no-delete-var": "error",
    "no-dupe-class-members": "error",
    "no-dupe-else-if": "error",
    "no-dupe-keys": "error",
    "no-duplicate-case": "error",
    "no-empty": "error",
    "no-empty-character-class": "error",
    "no-empty-pattern": "error",
    "no-empty-static-block": "error",
    "no-ex-assign": "error",
    "no-extra-boolean-cast": "error",
    "no-fallthrough": "error",
    "no-func-assign": "error",
    "no-global-assign": "error",
    "no-import-assign": "error",
    "no-invalid-regexp": "error",
    "no-loss-of-precision": "error",
    "no-misleading-character-class": "error",
    "no-new-native-nonconstructor": "error",
    "no-nonoctal-decimal-escape": "error",
    "no-obj-calls": "error",
    "no-prototype-builtins": "error",
    "no-redeclare": "error",
    "no-regex-spaces": "error",
    "no-self-assign": "error",
    "no-setter-return": "error",
    "no-shadow-restricted-names": "error",
    "no-sparse-arrays": "error",
    "no-this-before-super": "error",
    "no-undef": "error",
    "no-unexpected-multiline": "error",
    "no-unreachable": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    "no-unsafe-optional-chaining": "error",
    "no-unused-labels": "error",
    "no-unused-private-class-members": "error",
    "no-useless-backreference": "error",
    "no-useless-catch": "error",
    "no-useless-escape": "error",
    "no-with": "error",
    "require-yield": "error",
    "use-isnan": "error",
    "valid-typeof": "error",
    "no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      },
    ],
    "no-irregular-whitespace": [
      "error",
      {
        skipComments: true,
      },
    ],
  },
  // admin-css's fixtures are inputs to its tests, not code anything runs.
  ignorePatterns: ["packages/admin-css/__fixtures__/**"],
  overrides: [
    {
      files: [
        "scripts/**/*.test.mjs",
        "scripts/**/__tests__/**/*.mjs",
        "packages/eslint-plugin/src/__tests__/**/*.js",
        "packages/admin-css/**/*.test.mjs",
      ],
      env: { node: true, vitest: true },
    },
  ],
});
