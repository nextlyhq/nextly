// The repository's lint configuration: oxlint, with type-aware rules run
// through tsgolint, and the rules no built-in expresses as JS plugins.
//
// A JS module rather than JSON so the allowlists are read from the files
// that hold them, which their tests also read, instead of copied here.
import { readFileSync } from "node:fs";

import { defineConfig } from "oxlint";

/** Prefixes each path of a package-relative allowlist with the package. */
const inPackage = (pkg, paths) => paths.map(path => `packages/${pkg}/${path}`);

// Each allowlist is read by a literal path, which is how the CODEOWNERS test
// (scripts/merge-queue-workflows.test.mjs) finds the files a lint
// configuration depends on.

// Files that still throw a built-in error, each pinned to its count by
// scripts/lint-config.test.mjs.
const BARE_ERROR_ALLOWED = inPackage(
  "nextly",
  Object.keys(
    JSON.parse(
      readFileSync(
        new URL("./packages/nextly/bare-error-allowlist.json", import.meta.url),
        "utf8"
      )
    )
  )
);

// The two modules that build an API-key scope by hand, by design.
const API_KEY_SCOPE_ALLOWED = inPackage("nextly", [
  "src/auth/authenticated-scope.ts",
  "src/dispatcher/helpers/authenticated-actor.ts",
]);

// Modules that write to the terminal, each with the reason it may.
const CONSOLE_ALLOWED = inPackage(
  "nextly",
  Object.keys(
    JSON.parse(
      readFileSync(
        new URL("./packages/nextly/console-allowlist.json", import.meta.url),
        "utf8"
      )
    ).terminal
  )
);

/** Test files: exempt from the product rules below. */
const TESTS = [
  "**/*.test.{ts,tsx,mts,cts,js,jsx,mjs}",
  "**/*.spec.{ts,tsx,mts,cts,js,jsx,mjs}",
  "**/*.test-d.ts",
  "**/__tests__/**",
  "**/__mocks__/**",
];

const REACT_FILES = [
  "packages/admin/**/*.{ts,tsx,js,jsx}",
  "packages/ui/**/*.{ts,tsx,js,jsx}",
  "packages/blocks-react/**/*.{ts,tsx,js,jsx}",
  "packages/builder/**/*.{ts,tsx,js,jsx}",
  "packages/plugin-page-builder/**/*.{ts,tsx,js,jsx}",
  "apps/playground/**/*.{ts,tsx,js,jsx}",
  "packages/plugin-accounts/**/*.{ts,tsx,js,jsx}",
  "packages/plugin-form-builder/**/*.{ts,tsx,js,jsx}",
];

export default defineConfig({
  // Only the rules named here run, as under the ESLint configuration this
  // replaces: no category turns on rules beyond them.
  categories: { correctness: "off" },
  plugins: ["typescript", "unicorn", "import", "react", "nextjs"],
  jsPlugins: [
    "eslint-plugin-turbo",
    // import-x's ordering rule, which oxlint does not implement. Named apart
    // from oxlint's own "import" plugin, which takes the name import-x.
    { name: "import-order", specifier: "eslint-plugin-import-x" },
    "@nextlyhq/eslint-plugin",
    "./lint/guards.mjs",
  ],
  options: {
    typeAware: true,
    maxWarnings: 0,
    reportUnusedDisableDirectives: "error",
  },
  settings: {
    // Path aliases are this repository's own modules, ordered as internal.
    "import-x/internal-regex": "^(@nextly|@admin)/",
  },
  ignorePatterns: [
    "**/dist/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/node_modules/**",
    "**/*.d.ts",
    ...TESTS,
    // Scripts and executables are linted by `pnpm lint:scripts`
    // (oxlint.scripts.config.mjs) without type information.
    "**/scripts/**",
    "**/bin/**",
    "**/run-*.{ts,js,mjs}",
    // nextly's ad hoc scripts at the package root.
    "packages/nextly/test-*.ts",
    // Configuration files sit outside every package's TypeScript project.
    "**/*.config.{js,ts,mjs,cjs,mts,cts}",
    "**/*.config.*.{js,ts,mjs,cjs}",
    "**/vitest.global-setup.{js,ts,mjs,cjs}",
    "lint/**",
    // Copies and fixtures, linted where they are written.
    "templates/**",
    "packages/create-nextly-app/templates/**",
    "packages/eslint-plugin/**",
    "apps/playground/src/stubs/**",
  ],
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
    "no-irregular-whitespace": "error",
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
    "no-unreachable": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    "no-unsafe-optional-chaining": "error",
    "no-unused-labels": "error",
    "no-unused-private-class-members": "error",
    "no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "no-useless-backreference": "error",
    "no-useless-catch": "error",
    "no-useless-escape": "error",
    "no-with": "error",
    "require-yield": "error",
    "use-isnan": "error",
    "valid-typeof": "error",
    "no-array-constructor": "error",
    "no-unused-expressions": "error",
    "import/no-duplicates": "error",
    "import/first": "error",
    "import/newline-after-import": "warn",
    "typescript/await-thenable": "error",
    "typescript/ban-ts-comment": "error",
    "typescript/no-array-delete": "error",
    "typescript/no-base-to-string": "error",
    "typescript/no-duplicate-enum-values": "error",
    "typescript/no-duplicate-type-constituents": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-extra-non-null-assertion": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-for-in-array": "error",
    "typescript/no-implied-eval": "error",
    "typescript/no-misused-new": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-namespace": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-redundant-type-constituents": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-this-alias": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-enum-comparison": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-unsafe-unary-minus": "error",
    "typescript/no-wrapper-object-types": "error",
    "typescript/only-throw-error": "error",
    "typescript/prefer-as-const": "error",
    "typescript/prefer-namespace-keyword": "error",
    "typescript/prefer-promise-reject-errors": "error",
    "typescript/require-await": "warn",
    "typescript/restrict-plus-operands": "error",
    "typescript/restrict-template-expressions": "error",
    "typescript/triple-slash-reference": "error",
    "typescript/unbound-method": "error",
    "typescript/consistent-type-imports": [
      "warn",
      {
        fixStyle: "separate-type-imports",
      },
    ],
    "turbo/no-undeclared-env-vars": "warn",
    "import-order/order": [
      "warn",
      {
        groups: [
          "builtin",
          "external",
          "internal",
          "parent",
          "sibling",
          "index",
        ],
        "newlines-between": "always",
        alphabetize: {
          order: "asc",
          caseInsensitive: true,
        },
      },
    ],
  },
  overrides: [
    {
      // TypeScript checks these itself, so its sources turn them off; and it
      // asks for block-scoped declarations instead.
      files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
      rules: {
        "constructor-super": "off",
        "getter-return": "off",
        "no-class-assign": "off",
        "no-const-assign": "off",
        "no-dupe-class-members": "off",
        "no-dupe-keys": "off",
        "no-func-assign": "off",
        "no-import-assign": "off",
        "no-new-native-nonconstructor": "off",
        "no-obj-calls": "off",
        "no-redeclare": "off",
        "no-setter-return": "off",
        "no-this-before-super": "off",
        "no-unreachable": "off",
        "no-unsafe-negation": "off",
        "no-var": "error",
        "no-with": "off",
        "prefer-const": "error",
        "prefer-rest-params": "error",
        "prefer-spread": "error",
      },
    },
    {
      files: REACT_FILES,
      rules: {
        "react/display-name": "warn",
        "react/jsx-key": "error",
        "react/jsx-no-comment-textnodes": "error",
        "react/jsx-no-duplicate-props": "error",
        "react/jsx-no-target-blank": "error",
        "react/jsx-no-undef": "error",
        "react/no-children-prop": "error",
        "react/no-danger-with-children": "error",
        "react/no-direct-mutation-state": "error",
        "react/no-find-dom-node": "error",
        "react/no-is-mounted": "error",
        "react/no-render-return-value": "error",
        "react/no-string-refs": "error",
        "react/no-unescaped-entities": "warn",
        "react/no-unknown-property": "error",
        "react/no-unsafe": "off",
        "react/react-in-jsx-scope": "off",
        "react/rules-of-hooks": "error",
        "react/exhaustive-deps": "warn",
      },
    },
    {
      // Design tokens: every colour and style goes through the theme.
      files: [
        "packages/plugin-*/src/**/*.{ts,tsx}",
        "packages/admin/src/**/*.{ts,tsx}",
        "packages/ui/src/**/*.{ts,tsx}",
        "packages/builder/src/**/*.{ts,tsx}",
      ],
      rules: {
        "@nextlyhq/no-palette-classes": "error",
        "@nextlyhq/no-hardcoded-colors": "error",
        "@nextlyhq/no-static-inline-style": "error",
      },
    },
    {
      // Errors thrown in nextly carry a code: a bare Error is a 500.
      files: ["packages/nextly/src/**/*.{ts,tsx}"],
      excludeFiles: [...BARE_ERROR_ALLOWED, ...TESTS],
      rules: { "nextly/no-bare-error": "error" },
    },
    {
      // An API-key scope is built from the caller, never by hand.
      files: ["packages/nextly/src/**/*.{ts,tsx}"],
      excludeFiles: [...API_KEY_SCOPE_ALLOWED, ...TESTS],
      rules: { "nextly/api-key-scope": "error" },
    },
    {
      // nextly writes through a masked logger, not the console.
      files: ["packages/nextly/src/**/*.{ts,tsx}"],
      excludeFiles: [...CONSOLE_ALLOWED, ...TESTS],
      rules: {
        "no-console": "error",
        "no-restricted-globals": [
          "error",
          {
            name: "console",
            message:
              "Write through a masked logger (a service's logger or consoleLogger), not the console.",
          },
        ],
      },
    },
    {
      // The request path never loads the dev-only drizzle-kit entrypoints or
      // the migrate CLI: migrations are a CLI concern.
      files: [
        "packages/nextly/src/{init,route-handler,dispatcher,api,actions,direct-api}/**/*.ts",
        "packages/nextly/src/routeHandler.ts",
        "packages/nextly/src/next.ts",
      ],
      // These two load the migrate CLI through a dynamic `import()`, which the
      // ESLint rule this replaces never checked. They are the boot-time
      // migration path, exempt as they always were in effect.
      excludeFiles: [
        "packages/nextly/src/init/boot-apply.ts",
        "packages/nextly/src/init/prod-migrations.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/database/drizzle-kit-lazy",
                  "**/database/drizzle-kit-lazy.*",
                ],
                message:
                  "Handlers must not import drizzle-kit-lazy directly. Call a service in domains/schema/services/ instead. drizzle-kit's payload/* entrypoints are dev-only and should never be in a request graph.",
              },
              {
                group: [
                  "**/cli/commands/migrate",
                  "**/cli/commands/migrate.*",
                  "**/cli/commands/migrate-*",
                ],
                message:
                  "F11: deployed runtime must not import migrate-* CLI modules. Migrations are a CLI-only concern. See docs/guides/production-migrations.mdx.",
              },
            ],
          },
        ],
      },
    },
    {
      // The playground is a Next.js app. Its lint gated on Next's error-level
      // rules; it reads runtime harness flags no turbo task builds against,
      // and Next's async page components need no `await`.
      files: ["apps/playground/**/*.{ts,tsx,js,jsx}"],
      rules: {
        "nextjs/no-html-link-for-pages": "error",
        "nextjs/no-sync-scripts": "error",
        "turbo/no-undeclared-env-vars": "off",
        "typescript/require-await": "off",
        "import-order/order": "off",
      },
    },
    {
      // One owner for keyboard shortcuts: the admin's shortcut manager.
      files: ["packages/admin/src/**/*.{ts,tsx}"],
      rules: { "nextly/no-keyboard-listener": "error" },
    },
  ],
});
