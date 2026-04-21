import { config } from "@nextly/eslint-config/base";

export default [
  ...config,
  {
    ignores: [
      "packages/*/dist/**",
      "packages/*/.turbo/**",
      "node_modules/**",
      ".turbo/**",
      "**/*.d.ts",
      "packages/create-nextly-app/templates/**",
      // reason: shared eslint-config package's own .js files are not in
      // any tsconfig project; type-aware linting would fail on them
      "packages/eslint-config/**",
      // reason: per-package eslint.config.{js,mjs,ts} files and root-level
      // config files aren't in any tsconfig project; they are meant to be
      // maintained by hand, not linted as TS source
      "**/eslint.config.{js,mjs,cjs,ts}",
    ],
  },
];
