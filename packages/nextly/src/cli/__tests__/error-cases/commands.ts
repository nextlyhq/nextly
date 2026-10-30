/**
 * Cases for the project, admin and maintenance commands. Each command raises its own refusal
 * through a helper in `cli/errors/areas/commands.ts`, so the cases call those helpers with the
 * values the command passes; the block manifest's read failure is built as
 * `cli/commands/generate-manifest.ts` throws it.
 *
 * @module cli/__tests__/error-cases/commands
 */
import { NextlyError } from "../../../errors/nextly-error";
import {
  adminEmailInUse,
  adminEmailInvalid,
  adminNameMissing,
  adminPasswordMissing,
  adminPasswordsDiffer,
  adminPasswordTooWeak,
  blockManifestStale,
  buildGenerationFailed,
  buildMigrationsNotApplied,
  buildStrictWarnings,
  coreTablesNotCreated,
  coreTablesNotReconciled,
  databaseCatalogUnreadable,
  mediaApplyOutsideProject,
  mediaConfigOutsideProject,
  mediaStorageUnlistable,
  mediaThumbnailsNotRemoved,
  packageInstallFailed,
  passwordClearUnconfirmed,
  projectAlreadyInitialized,
  schemaSyncInProduction,
  setupAlreadyComplete,
  setupInProgress,
  setupTokenSetByEnv,
  componentMapOutOfDate,
} from "../../errors/areas/commands";

import { PROJECT, type ErrorCases } from "./types";

export const COMMAND_CASES = {
  PROJECT_ALREADY_INITIALIZED: () =>
    projectAlreadyInitialized(`${PROJECT}/nextly.config.ts`),
  PACKAGE_INSTALL_FAILED: () =>
    packageInstallFailed("pnpm", "@nextlyhq/plugin-seo", 1),
  BUILD_STRICT_WARNINGS: () =>
    buildStrictWarnings([
      'Collection "posts" field "author": relationship target "people" is not defined in this config.',
    ]),
  BUILD_GENERATION_FAILED: () => {
    // What the file system throws for a folder it may not write to.
    const cause = Object.assign(
      new Error(
        `EACCES: permission denied, mkdir '${PROJECT}/src/db/schemas/zod'`
      ),
      { code: "EACCES" }
    );
    return buildGenerationFailed(cause);
  },
  BUILD_MIGRATIONS_NOT_APPLIED: () =>
    buildMigrationsNotApplied({
      pendingMigrations: ["20261029_100000_add_posts"],
      failedMigrations: [],
    }),
  CORE_TABLES_NOT_RECONCILED: () => coreTablesNotReconciled(),
  DATABASE_CATALOG_UNREADABLE: () => databaseCatalogUnreadable(),
  CORE_TABLES_NOT_CREATED: () =>
    coreTablesNotCreated(new Error('permission denied for schema "public"')),
  SCHEMA_SYNC_IN_PRODUCTION: () => schemaSyncInProduction(["posts", "pages"]),
  BLOCK_MANIFEST_STALE: () =>
    blockManifestStale(
      `${PROJECT}/src/types/generated/blocks.manifest.json does not match this config.`
    ),
  BLOCK_MANIFEST_UNREADABLE: () => {
    const path = `${PROJECT}/src/types/generated/blocks.manifest.json`;
    const detail = `EACCES: permission denied, open '${path}'`;
    return NextlyError.invalidInput({
      message: `The block manifest at ${path} could not be read: ${detail}`,
      logContext: { reason: "block-manifest-unreadable", path, detail },
    });
  },
  MEDIA_STORAGE_UNLISTABLE: () => mediaStorageUnlistable("uploadthing"),
  MEDIA_THUMBNAILS_NOT_REMOVED: () =>
    mediaThumbnailsNotRemoved(1, [
      "Could not remove media/2026/10/0b7f0b0e-thumb_x.png: AccessDenied: Access Denied",
    ]),
  MEDIA_CONFIG_OUTSIDE_PROJECT: () =>
    mediaConfigOutsideProject("../other-project/nextly.config.ts", PROJECT),
  MEDIA_APPLY_OUTSIDE_PROJECT: () => mediaApplyOutsideProject(PROJECT),
  SETUP_IN_PROGRESS: () => setupInProgress("setup-token"),
  SETUP_ALREADY_COMPLETE: () => setupAlreadyComplete("users:create-admin"),
  SETUP_TOKEN_SET_BY_ENV: () => setupTokenSetByEnv("NEXTLY_SETUP_TOKEN"),
  ADMIN_EMAIL_INVALID: () => adminEmailInvalid("ada@"),
  ADMIN_NAME_MISSING: () => adminNameMissing(),
  ADMIN_PASSWORDS_DIFFER: () => adminPasswordsDiffer(),
  ADMIN_PASSWORD_MISSING: () => adminPasswordMissing("NEXTLY_ADMIN_PASSWORD"),
  ADMIN_PASSWORD_TOO_WEAK: () =>
    adminPasswordTooWeak(["Password must be at least 12 characters"]),
  ADMIN_EMAIL_IN_USE: () => adminEmailInUse(),
  PASSWORD_CLEAR_UNCONFIRMED: () =>
    passwordClearUnconfirmed(
      "--confirm-default-hasher",
      "users:clear-plaintext-passwords"
    ),
  COMPONENT_MAP_OUT_OF_DATE: () =>
    componentMapOutOfDate({
      files:
        "src/types/generated/plugin-admin-imports.generated.ts and src/types/generated/plugin-admin-components.generated.ts",
      disagreements: [
        '- missing: plugin "@acme/shop", widget "acme/revenue": @acme/shop/admin#Revenue',
        "- no longer declared: @gone/old/admin#Chart",
      ],
    }),
} satisfies ErrorCases;
