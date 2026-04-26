import { config } from "@nextly/eslint-config/base";

export default [
  ...config,
  // F1 PR 1: prevent request-graph code from importing the lazy drizzle-kit
  // module directly. Handlers must call services in domains/schema/services/,
  // never reach for drizzle-kit-lazy themselves. This is layering enforcement;
  // the load-bearing build-time safety lives in the magic comments inside
  // drizzle-kit-lazy.ts itself (webpackIgnore + turbopackIgnore), which keep
  // drizzle-kit/api out of the bundler's trace regardless of how deep the
  // import chain reaches. Globs are relative to packages/nextly/ because the
  // lint command (pnpm --filter @revnixhq/nextly lint) runs `eslint .` from
  // this package directory.
  {
    files: [
      "src/dispatcher/handlers/**/*.ts",
      "src/route-handler/**/*.ts",
      "src/actions/**/*.ts",
      "src/api/**/*.ts",
      "src/direct-api/**/*.ts",
      "src/routeHandler.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/database/drizzle-kit-lazy",
                "**/database/drizzle-kit-lazy.ts",
              ],
              message:
                "Handlers must not import drizzle-kit-lazy directly. Call a service in domains/schema/services/ instead. drizzle-kit/api is dev-only and should never be in a request graph.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      ".tsup/**",
      "dist/**",
      ".turbo/**",
      "node_modules/**",
      "test-*.ts",
      "tsup.config.js",
      "scripts/*.cjs",
      "scripts/*.js",
    ],
  },
  {
    // reason: build scripts and config files use Node globals + CJS requires
    files: ["tsup.config.{js,ts,mjs}", "*.config.{js,ts,mjs}", "scripts/**/*"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "import-x/no-unresolved": "off",
    },
  },
];
