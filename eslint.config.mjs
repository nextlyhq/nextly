import { config } from "@nextlyhq/eslint-config/base";
import { designTokensConfig } from "@nextlyhq/eslint-config/design-tokens";
import { reactRules } from "@nextlyhq/eslint-config/react-internal";

import { bareErrorConfig } from "./packages/nextly/eslint-bare-error-rule.js";

// Every surface that paints admin chrome is held to the token contract: the
// first-party plugins, the admin itself, and the kit they both draw from.
// Anything genuinely outside it — an email preview that mail clients render, a
// colour picker whose subject IS the colour — carries a `design-lint-ok`
// directive naming the reason, rather than being excluded here where the
// exclusion would silently cover whatever is added next.
const ADMIN_UI_FILES = [
  "packages/plugin-*/src/**/*.{ts,tsx}",
  "packages/admin/src/**/*.{ts,tsx}",
  "packages/ui/src/**/*.{ts,tsx}",
  // The builder keeps its own `--nx-builder-*` namespace, and these rules do
  // not care which namespace a token belongs to — they care whether a colour
  // was written down instead of referenced, and whether a hue stood in for a
  // meaning. `scripts/lint-design.mjs` reads this tree too, but its
  // hardcoded-colour rule only runs on CSS files and plugin surfaces, so a
  // literal in a builder `.tsx` was caught by neither guard.
  "packages/builder/src/**/*.{ts,tsx}",
];

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
  "packages/blocks-react/**/*.{ts,tsx,js,jsx}",
  "packages/builder/**/*.{ts,tsx,js,jsx}",
  "packages/plugin-page-builder/**/*.{ts,tsx,js,jsx}",
  "apps/playground/**/*.{ts,tsx,js,jsx}",
];

export default [
  ...config,
  ...reactRules.map(entry => ({ ...entry, files: REACT_FILES })),
  // Mount packages/nextly's bare-`Error` guard here too, with its globs rewritten relative to
  // the repository root. ESLint picks a flat config by CWD rather than by linted file, so a
  // rule that lives only in the package config is absent from every root invocation — which
  // includes lint-staged, the hook that runs before a commit is written. Same reason as the
  // React block above.
  bareErrorConfig("packages/nextly/"),
  ...designTokensConfig(ADMIN_UI_FILES),
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
      // reason: same case — the eslint-plugin package ships plain ESM rule
      // modules with no tsconfig project, and is linted by its own config
      // (`js.configs.recommended`) through its package `lint` script.
      "packages/eslint-plugin/**",
      // reason: per-package eslint.config.{js,mjs,ts} files and root-level
      // config files aren't in any tsconfig project; they are meant to be
      // maintained by hand, not linted as TS source
      "**/eslint.config.{js,mjs,cjs,ts}",
      // reason: same as the configs above — a rule module beside a package's eslint config is
      // not in that package's tsconfig project, so typed linting cannot resolve it.
      "packages/nextly/eslint-bare-error-rule.js",
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
