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
  // F11 PR 5: prevent the deployed app's runtime code from importing
  // any migrate-* CLI module. The CLI commands (migrate, migrate:create,
  // migrate:check, migrate:status, migrate:fresh) are intended to be
  // invoked manually before deploy — never from a request graph or
  // boot-time path. See docs/guides/production-migrations.mdx.
  //
  // Scoped to the runtime folders listed below so that the CLI source
  // (cli/), the schema-domain (domains/schema/), and tests can still
  // freely cross-reference the migrate-* modules.
  //
  // We use the `regex` matcher (not `group`) because relative imports
  // like `../cli/commands/migrate.js` aren't matched by minimatch's
  // `**` traversal. The regex matches any path containing
  // `cli/commands/migrate` (with or without -create / -check / etc).
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
            // Re-state the drizzle-kit-lazy ban here so this overrides
            // block doesn't accidentally relax it for init/. ESLint
            // applies the LAST matching rule, not a union.
            //
            // Notes on patterns: eslint's `no-restricted-imports`
            // patterns use minimatch with default options. `**` does
            // NOT match `..`, so we list per-depth patterns explicitly.
            // Two-segment depth covers init/, three-segment depth
            // covers route-handler/handler/, etc. Trailing `.*`
            // matches the `.js` / `.ts` extension.
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
                "Handlers must not import drizzle-kit-lazy directly. Call a service in domains/schema/services/ instead.",
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
