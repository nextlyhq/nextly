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
      // reason: top-level templates (`templates/blog`, `templates/base`,
      // `templates/blank`) have no tsconfig of their own; they are
      // scaffolded into user projects at `create-nextly-app` time where
      // they get linted. Typed-linting at the monorepo level fails with
      // "not found by the project service".
      "templates/**",
      // reason: shared eslint-config package's own .js files are not in
      // any tsconfig project; type-aware linting would fail on them
      "packages/eslint-config/**",
      // reason: per-package eslint.config.{js,mjs,ts} files and root-level
      // config files aren't in any tsconfig project; they are meant to be
      // maintained by hand, not linted as TS source
      "**/eslint.config.{js,mjs,cjs,ts}",
      // reason: vitest config files aren't in any tsconfig project either.
      // F18 added vitest.integration.config.ts as a sibling of vitest.config.ts
      // to split unit/integration suites; both are config-only and not
      // application source.
      "**/vitest.config.ts",
      "**/vitest.*.config.ts",
    ],
  },
];
