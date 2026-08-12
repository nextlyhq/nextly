import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "@nextlyhq/eslint-config/base";

/**
 * Files that still throw a bare `Error`, exempt from the guard below until they do not.
 *
 * Held as JSON rather than a module: it is data, and a `.js` beside the config gets picked up
 * by lint-staged and parsed as typed source, which fails because it is outside the TS project.
 * JSON has no such problem and needs no declaration file to stay typed at its other reader,
 * `src/errors/__tests__/bare-error-allowlist.test.ts`.
 */
const BARE_ERROR_ALLOWLIST = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "eslint-bare-error-allowlist.json"
    ),
    "utf8"
  )
);

export default [
  ...config,
  {
    // A thrown bare `Error` reaches the API layer with no code to map, so it becomes a 500
    // whatever it actually was — a caller-fixable refusal reads as a server fault, and the
    // message is the only thing left to act on. `NextlyError` carries the code instead.
    //
    // The rule already existed in AGENTS.md and had 304 violations, because nothing checked:
    // where the correct path and the easy path differ, the easy one wins. This makes the
    // easy path fail.
    //
    // Enforced as a syntax restriction rather than a bespoke rule so there is no plugin to
    // build or version — the same trade this repo made for the keyboard-listener guard in
    // `packages/admin/eslint.config.js`. The selector matches the throw itself, which is the
    // thing that must not appear.
    //
    // Existing violations are exempted BY FILE so this lands green rather than as a 107-file
    // change nobody can review. See `eslint-bare-error-allowlist.js` for what that does and
    // does not cover.
    files: ["src/**/*.ts"],
    ignores: [
      ...BARE_ERROR_ALLOWLIST,
      // Tests may throw whatever makes a failure legible; they never cross the API boundary.
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message:
            "Throw a NextlyError, not a bare Error. A bare Error carries no code, so the API layer reports it as a 500 even when it is a caller-fixable refusal. Use NextlyError.validation / .notFound / .conflict / .internal, or `new NextlyError({ code, publicMessage })` for a code without a factory.",
        },
      ],
    },
  },
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
                "Handlers must not import drizzle-kit-lazy directly. Call a service in domains/schema/services/ instead. drizzle-kit's payload/* entrypoints are dev-only and should never be in a request graph.",
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
      // Config DATA for the rule above, not source. Same treatment as the other
      // root-level config files: outside the TS project service, so linting it as
      // typed source fails to parse.
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
