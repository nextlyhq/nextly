/**
 * Cases for the codes `nextly migrate:create` raises itself, through the helpers it calls.
 *
 * @module cli/__tests__/error-cases/migrate-create
 */
import {
  migrationCreateCancelled,
  migrationNameRequired,
} from "../../errors/areas/migrate-create";

import type { ErrorCases } from "./types";
import { NextlyError } from "../../../errors/nextly-error";
import { runMigrateCreate } from "../../commands/migrate-create";
import { createLogger } from "../../utils/logger";

export const MIGRATE_CREATE_CASES = {
  MIGRATION_NAME_REQUIRED: () => migrationNameRequired(),
  MIGRATION_CREATE_CANCELLED: () => migrationCreateCancelled(),
  // The command's own first check, run for real: it refuses before reading anything.
  NO_TRANSACTION_NEEDS_BLANK: () =>
    runMigrateCreate(
      undefined,
      { transaction: false, blank: false } as Parameters<
        typeof runMigrateCreate
      >[1],
      { logger: createLogger({ quiet: true }) } as Parameters<
        typeof runMigrateCreate
      >[2]
    ).then(
      () => {
        throw new Error("expected the flag to be refused");
      },
      (error: unknown) => error
    ),
  // The refusals below are built as `cli/commands/migrate-create.ts` throws them.
  PLUGIN_EXTENDS_OUTSIDE_ITS_SCHEMA: () =>
    NextlyError.invalidInput({
      message:
        'Plugin "@acme/seo" has a schema.extend hook that extends "posts", which is not in the schema this command compiles. ' +
        "A plugin's migration module ships inside the plugin, so it is compiled from the plugin and its DECLARED DEPENDENCIES alone — never from the app's entity tables, which differ per installation. " +
        'If "posts" belongs to a dependency, add that dependency to dependsOn and make sure it is present in the config this command loads. ' +
        "If it is one of the app's collections, Singles or field groups, what the hook adds to it is migrated by the APP: `nextly migrate:create` in the app writes it, whoever contributed it. " +
        'Guard the hook with `schema.getTable("posts")` so it skips the table when compiled for this module.',
      logContext: { reason: "plugin-extend-target-outside", target: "posts" },
    }),
  PLUGIN_ENTRY_EXPORTS_SEVERAL: () =>
    NextlyError.invalidInput({
      message:
        "The plugin entry src/plugin.ts exports more than one plugin (seo, sitemap). Point --plugin at a file that exports one, or export it as the default.",
      logContext: {
        reason: "plugin-entry-exports-several",
        entry: "src/plugin.ts",
      },
    }),
  PLUGIN_ENTRY_UNNAMED: () =>
    new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        "The plugin entry src/plugin.ts exports no definition with a name, so its migrations cannot be attributed.",
      statusCode: 400,
      logContext: { reason: "plugin-entry-unnamed" },
    }),
  PLUGIN_SCHEMA_VERSION_MISSING: () =>
    new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        'Plugin "@acme/seo" declares no schemaVersion. A plugin needs one before migrations can be generated for it.',
      statusCode: 400,
      logContext: { reason: "plugin-schema-version-missing" },
    }),
  PLUGIN_MIGRATIONS_BARREL_UNREADABLE: () =>
    new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        "The plugin's existing migrations barrel at src/migrations/index.ts could not be loaded.",
      statusCode: 400,
      logContext: {
        reason: "plugin-migrations-barrel-unreadable",
        barrel: "src/migrations/index.ts",
        detail:
          "Cannot find module './0002_add_redirects' imported from src/migrations/index.ts.",
      },
    }),
} satisfies ErrorCases;
