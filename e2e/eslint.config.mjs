import { config } from "@nextlyhq/eslint-config/base";

// Annotate the export with a named type from `eslint` so tsc doesn't have to
// infer it from `@eslint/core`'s internal types, which are not portable across
// versions (TS2742). This file is typechecked because e2e deliberately
// includes `**/*.mjs`.
/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...config,
  {
    ignores: ["node_modules/**", ".playwright/**"],
  },
];

export default eslintConfig;
