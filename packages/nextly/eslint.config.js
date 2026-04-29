import { config } from "@nextly/eslint-config/base";

export default [
  ...config,
  // F1 PR 1 + F11 PR 5: bans on imports from the deployed app's
  // runtime code (the request graph + boot path).
  //
  // 1. drizzle-kit-lazy: handlers must call services in
  //    domains/schema/services/ instead. The load-bearing build-time
  //    safety lives in the magic comments inside drizzle-kit-lazy.ts
  //    itself (webpackIgnore + turbopackIgnore); this rule is layering
  //    enforcement.
  //
  // 2. cli/commands/migrate-* (F11 PR 5): migrate, migrate:create,
  //    migrate:check, migrate:status, migrate:fresh are CLI-only.
  //    They run as a deploy step, never in a request graph or
  //    boot-time path. See docs/guides/production-migrations.mdx.
  //
  // Scoped to the runtime folders below; the CLI source (cli/),
  // schema-domain (domains/schema/), and tests can still cross-
  // reference these freely.
  //
  // Pattern note: eslint's `no-restricted-imports` uses minimatch
  // with default options. `**` does NOT match `..` in relative-import
  // strings, so `**/cli/commands/migrate.js` does NOT match
  // `../cli/commands/migrate.js`. We enumerate per-depth prefixes
  // (`../`, `../../`, `../../../`) explicitly. Globs are relative to
  // packages/nextly/ because the lint command runs `eslint .` from
  // this directory.
  {
    files: [
      "src/init/**/*.ts",
      "src/route-handler/**/*.ts",
      "src/dispatcher/**/*.ts",
      "src/api/**/*.ts",
      "src/actions/**/*.ts",
      "src/direct-api/**/*.ts",
      "src/routeHandler.ts",
      "src/next.ts",
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
                "../database/drizzle-kit-lazy",
                "../database/drizzle-kit-lazy.*",
                "../../database/drizzle-kit-lazy",
                "../../database/drizzle-kit-lazy.*",
                "../../../database/drizzle-kit-lazy",
                "../../../database/drizzle-kit-lazy.*",
              ],
              message:
                "Handlers must not import drizzle-kit-lazy directly. Call a service in domains/schema/services/ instead. drizzle-kit/api is dev-only and should never be in a request graph.",
            },
            {
              group: [
                "**/cli/commands/migrate",
                "**/cli/commands/migrate.*",
                "**/cli/commands/migrate-*",
                "../cli/commands/migrate",
                "../cli/commands/migrate.*",
                "../cli/commands/migrate-*",
                "../../cli/commands/migrate",
                "../../cli/commands/migrate.*",
                "../../cli/commands/migrate-*",
                "../../../cli/commands/migrate",
                "../../../cli/commands/migrate.*",
                "../../../cli/commands/migrate-*",
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
    ignores: [
      ".tsup/**",
      "dist/**",
      ".turbo/**",
      "node_modules/**",
      "test-*.ts",
      "tsup.config.js",
      "vitest.config.ts",
      "vitest.*.config.ts",
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
