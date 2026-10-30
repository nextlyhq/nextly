/**
 * Cases for a configuration the CLI could not read. Each mirrors the loader's throw in
 * `cli/utils/config-loader.ts`; the syntax error and the missing file also run end to end in
 * `error-shape.test.ts`.
 *
 * @module cli/__tests__/error-cases/config
 */
import { NextlyError } from "../../../errors/nextly-error";
import { configDeclarationError } from "../../errors/areas/config";

import { PROJECT, type ErrorCases } from "./types";

/** An esbuild build failure, as the bundler rethrows it: an Error carrying esbuild's messages. */
function buildFailure(text: string, line: number, column: number): Error {
  const failure = new Error(
    `Build failed with 1 error:\nnextly.config.ts:${line}:${column}: ERROR: ${text}`
  );
  return Object.assign(failure, {
    errors: [{ text, location: { file: "nextly.config.ts", line, column } }],
  });
}

/** The loader's wrapper for a failure while compiling or running the configuration. */
function loadError(cause: Error): NextlyError {
  return new NextlyError({
    code: "INVALID_INPUT",
    publicMessage: "Failed to load Nextly configuration.",
    statusCode: 400,
    logMessage: "Config loader error",
    logContext: {
      configPath: `${PROJECT}/nextly.config.ts`,
      reason: "load-error",
      cause: cause.message,
    },
    cause,
  });
}

export const CONFIG_CASES = {
  CONFIG_NOT_FOUND: () =>
    new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: "Failed to load Nextly configuration.",
      statusCode: 400,
      logMessage: "Config loader error",
      logContext: {
        configPath: `${PROJECT}/config/nextly.config.ts`,
        requested: "config/nextly.config.ts",
        reason: "config-not-found",
      },
    }),
  CONFIG_SYNTAX_ERROR: () =>
    loadError(buildFailure('Expected "}" but found "fields"', 3, 20)),
  CONFIG_IMPORT_NOT_FOUND: () =>
    loadError(buildFailure('Could not resolve "./collections/posts"', 2, 22)),
  CONFIG_LOAD_FAILED: () =>
    loadError(
      new TypeError("Cannot read properties of undefined (reading 'slug')")
    ),
  CONFIG_INVALID_EXPORT: () =>
    new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: "Failed to load Nextly configuration.",
      statusCode: 400,
      logMessage: "Config loader error",
      logContext: {
        configPath: `${PROJECT}/nextly.config.ts`,
        reason: "invalid-config-export",
        exportType: "undefined",
      },
    }),
  PLUGIN_SETUP_FAILED: () => {
    const cause = new Error(
      "seo: `collections` must name at least one collection"
    );
    return new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: "Failed to load Nextly configuration.",
      statusCode: 400,
      logMessage: "Config loader error",
      logContext: {
        configPath: `${PROJECT}/nextly.config.ts`,
        reason: "plugin-setup-transformer-failed",
        pluginName: "@nextlyhq/plugin-seo",
        cause: cause.message,
      },
      cause,
    });
  },
  CONFIG_INVALID: () =>
    configDeclarationError(
      NextlyError.validation({
        errors: [
          {
            path: "collections.posts.rating.type",
            code: "FIELD_TYPE_INVALID",
            message:
              "Invalid field type 'stars'. No built-in type, and no installed plugin offers it on this surface.",
          },
        ],
      })
    ),
  CONFIG_TOOLING_UNAVAILABLE: () =>
    new NextlyError({
      code: "NEXTLY_CONFIG_TOOLING_UNAVAILABLE",
      publicMessage:
        'Reading "nextly.config.ts" needs the "esbuild" package, which is not installed.',
      logContext: {
        reason: "esbuild-unavailable",
        cause: "Cannot find package 'esbuild'",
      },
    }),
  // As `serverProblems` in `domains/workflows/registry.ts` lists it, refused by `buildWorkflowRegistry`.
  WORKFLOW_CANNOT_ATTACH: () =>
    NextlyError.validation({
      errors: [
        {
          path: "collections.pages.workflow",
          code: "workflow_needs_drafts",
          message:
            "`editorial` cannot be attached to `pages`: it does not keep drafts: set `status: true` and `versions: { drafts: true }`.",
        },
      ],
    }),
} satisfies ErrorCases;
