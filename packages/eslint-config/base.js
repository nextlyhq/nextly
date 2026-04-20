import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import onlyWarn from "eslint-plugin-only-warn";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
      // Honor the leading-underscore convention for intentionally unused
      // identifiers (params, destructured vars, caught errors). Without
      // this override, tseslint.configs.recommended flags `_foo` as unused
      // even though the underscore is the documented escape hatch.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: true,
        node: true,
      },
    },
    rules: {
      "import/order": [
        "warn",
        {
          groups: [
            "builtin", // Node.js built-ins (fs, path, etc.)
            "external", // npm packages (react, next, etc.)
            "internal", // @nextly/* and nextly packages
            "parent", // ../
            "sibling", // ./
            "index", // ./index
          ],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
      "import/no-duplicates": "warn",
      "import/first": "warn",
      "import/newline-after-import": "warn",
      "import/no-unresolved": [
        "error",
        {
          ignore: [
            "\\.css$", // CSS imports (handled by bundlers)
            "\\.scss$", // SCSS imports (handled by bundlers)
            "\\.svg$", // SVG imports (may be handled as components)
            "\\.png$", // Image imports
            "\\.jpg$", // Image imports
            "\\.jpeg$", // Image imports
            "\\.gif$", // Image imports
            "\\.webp$", // Image imports
          ],
        },
      ],
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    ignores: [
      "dist/**",
      // tsup writes a bundled copy of tsup.config.ts to disk during build
      // (e.g. tsup.config.bundled_abc123.mjs) — treat these as build
      // artifacts, not source.
      "**/tsup.config.bundled_*.mjs",
      "**/tsup.config.bundled_*.cjs",
    ],
  },
];
