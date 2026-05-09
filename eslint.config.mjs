import { config } from "@nextlyhq/eslint-config/base";
import { reactRules } from "@nextlyhq/eslint-config/react-internal";

// Apply the React + react-hooks rule set to React-bearing paths so
// inline `// eslint-disable-next-line react-hooks/...` directives
// resolve when lint-staged invokes ESLint from the repo root. Without
// this, the root config has no react-hooks plugin registered and any
// such directive fails with "Definition for rule ... was not found".
// Per-package configs (admin, ui, playground) still apply the same
// rules unconditionally.
const REACT_FILES = [
  "packages/admin/**/*.{ts,tsx,js,jsx}",
  "packages/ui/**/*.{ts,tsx,js,jsx}",
  "apps/playground/**/*.{ts,tsx,js,jsx}",
];

export default [
  ...config,
  ...reactRules.map(entry => ({ ...entry, files: REACT_FILES })),
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
      // reason: playground's mysql2 stub is a plain JS shim used by
      // Turbopack's resolveAlias for optional-peer-dep handling; not
      // part of any tsconfig project.
      "apps/playground/src/stubs/**",
      // reason: root-level Playwright config and the e2e/ specs are
      // not in any tsconfig project; they are run by `playwright test`
      // directly. typed-linting would fail with "not found by the
      // project service".
      "playwright.config.ts",
      "e2e/**",
    ],
  },
];
