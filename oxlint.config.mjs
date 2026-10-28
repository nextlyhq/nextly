// The repository's lint configuration: oxlint, with type-aware rules run
// through tsgolint, and the rules no built-in expresses as JS plugins.
//
// A JS module rather than JSON so the allowlists are read from the files
// that hold them, which their tests also read, instead of copied here.
import { readFileSync } from "node:fs";

import { defineConfig } from "oxlint";

import {
  IMPORT_CYCLES,
  NEXTLY_SOURCE,
  NO_CYCLE,
} from "./lint/import-cycles.mjs";

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

/**
 * Modules the deployed request path never loads: drizzle-kit's dev-only
 * entrypoints and the migrate CLI. One list, held by two rules below.
 */
const REQUEST_PATH_RESTRICTED = [
  {
    group: ["**/database/drizzle-kit-lazy", "**/database/drizzle-kit-lazy.*"],
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
];

/**
 * One dialect's table definitions, which nextly's product code reads through
 * the loaded dialect (`loadedDialect`, `getDialectTables`) so that a process
 * imports only its own dialect's tables. A value import of a dialect file, or
 * of a feature barrel that re-exports all three, puts every dialect into every
 * process that loads the importer. Type-only imports load nothing.
 */
const DIALECT_TABLE_RESTRICTED = [
  {
    group: [
      "**/schemas/*/postgres",
      "**/schemas/*/mysql",
      "**/schemas/*/sqlite",
      // The feature barrels that re-export all three dialects' files.
      "**/schemas/{dynamic-collections,dynamic-field-groups,email-providers,email-templates,user-field-definitions}",
      "**/schemas/{dynamic-collections,dynamic-field-groups,email-providers,email-templates,user-field-definitions}/index",
    ],
    allowTypeImports: true,
    message:
      "Read a dialect's tables through the loaded dialect (loadedDialect or getDialectTables from database/), not by importing a dialect's file: that loads every dialect in every process.",
  },
];

/**
 * The React Compiler rules of eslint-plugin-react-hooks 7's recommended
 * preset that oxlint implements, under its `react` plugin. The preset's
 * `config` and `gating` rules check the compiler's own configuration and have
 * no port; `rules-of-hooks` and `exhaustive-deps` are on for every React
 * package already.
 */
const REACT_COMPILER_RULES = [
  "error-boundaries",
  "globals",
  "immutability",
  "incompatible-library",
  "preserve-manual-memoization",
  "purity",
  "refs",
  "set-state-in-effect",
  "set-state-in-render",
  "static-components",
  "unsupported-syntax",
  "use-memo",
];

/**
 * The accessibility rules of Next.js's core-web-vitals preset, which is what
 * the playground was linted with: `alt-text` for `<img>` and next/image's
 * `Image`, and the ARIA attribute and role checks.
 */
const NEXT_A11Y_RULES = {
  "jsx-a11y/alt-text": ["error", { elements: ["img"], img: ["Image"] }],
  "jsx-a11y/aria-props": "error",
  "jsx-a11y/aria-proptypes": "error",
  "jsx-a11y/aria-unsupported-elements": "error",
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/role-supports-aria-props": "error",
};

/** Every rule oxlint implements from Next.js's own lint preset. */
const NEXT_RULES = [
  "google-font-display",
  "google-font-preconnect",
  "inline-script-id",
  "next-script-for-ga",
  "no-assign-module-variable",
  "no-async-client-component",
  "no-before-interactive-script-outside-document",
  "no-css-tags",
  "no-document-import-in-page",
  "no-duplicate-head",
  "no-head-element",
  "no-head-import-in-document",
  "no-html-link-for-pages",
  "no-img-element",
  "no-page-custom-font",
  "no-script-component-in-head",
  "no-styled-jsx-in-document",
  "no-sync-scripts",
  "no-title-in-document-head",
  "no-typos",
  "no-unwanted-polyfillio",
];

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
    // The lint configurations themselves, and vitest's configuration and
    // global setup, as before: they sit outside every package's TypeScript
    // project. Every other configuration file is linted.
    "oxlint.config.mjs",
    "oxlint.scripts.config.mjs",
    "oxlint.templates.config.mjs",
    "**/vitest.config.{ts,mjs}",
    "**/vitest.*.config.ts",
    "**/vitest.global-setup.{js,ts,mjs,cjs}",
    "lint/**",
    // Copies and fixtures, linted where they are written.
    "templates/**",
    "packages/create-nextly-app/templates/**",
    "packages/eslint-plugin/**",
    "apps/playground/src/stubs/**",
    // The playground's scripts and tests run in its TypeScript project and
    // were always linted with it, so they are taken back from the two
    // exclusions above.
    "!apps/playground/scripts/**",
    "!apps/playground/**/__tests__/**",
    "!apps/playground/**/*.test.{ts,tsx}",
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
    // Under `verbatimModuleSyntax` an import whose names are all marked `type`
    // inline (`import { type A } from "./x"`) is kept as `import "./x"`, so the
    // bundler keeps a module the code never uses. `import type { A }` is
    // dropped whole.
    "typescript/no-import-type-side-effects": "error",
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
        "react/require-render-return": "error",
        // eslint-plugin-react's `no-deprecated`, which oxlint has no port of:
        // the deprecated lifecycles here, and the removed APIs by the type
        // check (React 19's types no longer declare them). The type-aware
        // `typescript/no-deprecated` is not a stand-in: it reports every
        // `@deprecated` API, not React's, and is a policy of its own.
        "nextly/no-legacy-lifecycle": "error",
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
      // No file newly on an import cycle in nextly's source. The files already
      // on one are exempt, and scripts/lint-config.test.mjs holds those cycles
      // to the groups lint/import-cycles.mjs lists, so the exemption only
      // shrinks. A new import between two files already in one group is not
      // caught: see lint/import-cycles.mjs.
      files: [`${NEXTLY_SOURCE}/**/*.{ts,tsx}`],
      excludeFiles: IMPORT_CYCLES.flat().map(
        file => `${NEXTLY_SOURCE}/${file}`
      ),
      rules: { "import/no-cycle": NO_CYCLE },
    },
    {
      // No top-level await in nextly's source: the deadlock a cycle through a
      // dynamic import could cause, which import/no-cycle cannot see. Every
      // file, the cycle-exempt ones included; tests load modules at their top
      // level on purpose. What it covers and what it does not: lint/guards.mjs.
      files: [`${NEXTLY_SOURCE}/**/*.{ts,tsx}`],
      excludeFiles: TESTS,
      rules: { "nextly/no-top-level-await": "error" },
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
      // Product code reads a dialect's tables through the loaded dialect. The
      // schema files themselves, the loader and tests are exempt. Before the
      // request-path override, which repeats these patterns: a later override
      // replaces this rule's options for the files both match.
      files: ["packages/nextly/src/**/*.{ts,tsx}"],
      excludeFiles: [
        "packages/nextly/src/schemas/**",
        "packages/nextly/src/database/dialect-tables.ts",
        ...TESTS,
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          { patterns: DIALECT_TABLE_RESTRICTED },
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
      // These two are the boot-time migration path, and load the migrate CLI
      // through `import()` on purpose. They get the override below instead,
      // which still refuses a static import there.
      excludeFiles: [
        "packages/nextly/src/init/boot-apply.ts",
        "packages/nextly/src/init/prod-migrations.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [...REQUEST_PATH_RESTRICTED, ...DIALECT_TABLE_RESTRICTED],
          },
        ],
      },
    },
    {
      // The boot-time migration path: the CLI may be loaded lazily, through
      // `import()`, and through no static import that would put it in the
      // deployed graph.
      files: [
        "packages/nextly/src/init/boot-apply.ts",
        "packages/nextly/src/init/prod-migrations.ts",
      ],
      rules: {
        "nextly/no-static-restricted-import": [
          "error",
          {
            patterns: [...REQUEST_PATH_RESTRICTED, ...DIALECT_TABLE_RESTRICTED],
          },
        ],
      },
    },
    {
      // The playground is a Next.js app, linted with every rule of Next's
      // preset at error, as its lint ran with no warning allowed: Next's own
      // rules, the React Compiler rules and the accessibility rules its
      // core-web-vitals preset turns on. It reads runtime harness flags no
      // turbo task builds against, and Next's async page components need no
      // `await`.
      files: ["apps/playground/**/*.{ts,tsx,js,jsx}"],
      plugins: ["jsx-a11y"],
      rules: {
        ...Object.fromEntries(
          NEXT_RULES.map(rule => [`nextjs/${rule}`, "error"])
        ),
        ...Object.fromEntries(
          REACT_COMPILER_RULES.map(rule => [`react/${rule}`, "error"])
        ),
        ...NEXT_A11Y_RULES,
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
    {
      // The Tabs primitive owns its indicator: a call site passes layout, and a
      // different indicator is a change to the primitive. Every extension JSX
      // is legal in, since a JavaScript app writes JSX in `.js` too.
      files: ["packages/**/*.{tsx,jsx,js}", "apps/**/*.{tsx,jsx,js}"],
      rules: { "nextly/tab-indicator": "error" },
    },
  ],
});
