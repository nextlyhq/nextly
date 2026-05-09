import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint configuration — base layer.
 *
 * Philosophy (alpha 2026-04): industry-standard baseline mirroring Payload CMS.
 * Type-aware linting enabled for bug-catcher rules; noisy no-unsafe-* family
 * disabled to match Payload's posture. `projectService: true` auto-discovers
 * the nearest tsconfig.json per file, which is correct for this monorepo.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  eslintConfigPrettier,
  {
    plugins: { turbo: turboPlugin },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",

      // Core TS rules
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unsafe-function-type": "error",
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-require-imports": "error",

      // Type-aware bug-catchers (error — real bugs)
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/unbound-method": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/require-await": "warn",

      // Type-aware noise family — disabled per Payload posture.
      // These fire on any `any`-typed value and generate too much noise while
      // the codebase still has ~400 intentional `any` escape hatches.
      // Reconsider post-alpha when the `any` footprint shrinks.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: [
            "tsconfig.json",
            "packages/*/tsconfig.json",
            "apps/*/tsconfig.json",
          ],
        }),
        createNodeResolver({
          extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
        }),
      ],
    },
    rules: {
      "import-x/order": [
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
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import-x/no-duplicates": "error",
      "import-x/first": "error",
      "import-x/newline-after-import": "warn",
      "import-x/no-unresolved": [
        "error",
        {
          ignore: [
            "\\.css$",
            "\\.scss$",
            "\\.svg$",
            "\\.png$",
            "\\.jpg$",
            "\\.jpeg$",
            "\\.gif$",
            "\\.webp$",
          ],
        },
      ],
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    ignores: [
      "dist/**",
      // tsup writes a bundled copy of tsup.config.ts to disk during build
      // (e.g. tsup.config.bundled_abc123.mjs) — treat these as build artifacts.
      "**/tsup.config.bundled_*.mjs",
      "**/tsup.config.bundled_*.cjs",
      // reason: config files (tsup, next, vitest, eslint) aren't in any
      // tsconfig project, so type-aware linting can't resolve them. They
      // are maintained by hand and don't need lint coverage.
      "**/tsup.config.{js,ts,mjs,cjs}",
      "**/next.config.{js,ts,mjs,cjs}",
      "**/vitest.config.{js,ts,mjs,cjs}",
      "**/vite.config.{js,ts,mjs,cjs}",
      "**/eslint.config.{js,ts,mjs,cjs}",
      "**/postcss.config.{js,ts,mjs,cjs}",
      "**/tailwind.config.{js,ts,mjs,cjs}",
      // reason: test files are excluded from tsconfig, so type-aware lint
      // can't resolve them. Quality is enforced by vitest at test-time.
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**/*",
      "**/__mocks__/**/*",
      // reason: scripts, binaries, and root-level dev-tooling configs live
      // outside each package's tsconfig project (they are not published
      // source — they are dev tooling). Type-aware lint cannot resolve them.
      "**/scripts/**/*",
      "**/bin/**/*",
      "**/run-*.{ts,js,mjs}",
      "**/rollup.*.config.{ts,js,mjs}",
      "**/drizzle.config.{ts,js,mjs}",
    ],
  },
];
