/**
 * Flat PostgreSQL dialect bundle.
 *
 * Replaces the legacy `database/schema/postgres.ts` runtime surface deleted
 * in Plan A Task 17. Re-exports every Drizzle table + relations the
 * framework manages, drawn from the canonical per-feature
 * `schemas/<feature>/postgres.ts` modules, under the bare names callers
 * have always used (`apiKeys`, `users`, `dynamicCollections`, …).
 *
 * Consumers reach this module through `getDialectTables("postgresql")` /
 * `import { schema } from "@nextly/database"`. New consumers should prefer
 * `getCoreSchema(dialect)` from `@nextly/schemas`, which returns a
 * `NextlySchemaSnapshot` (dialect-keyed `TableSpec[]`) rather than the
 * Drizzle-native flat namespace this bundle exposes.
 *
 * @module schemas/_dialect-bundles/postgres
 * @since v0.0.3-alpha (Plan A Task 17 — replaces database/schema/postgres.ts)
 */

// Users + Auth.js identity (tables + relations co-exported from the file).
export {
  users,
  accounts,
  sessions,
  usersRelations,
  accountsRelations,
  sessionsRelations,
} from "../users/postgres";

// Auth tokens.
export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
  refreshTokensRelations,
} from "../auth-tokens/postgres";

// RBAC.
export {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
  rolesRelations,
  permissionsRelations,
  rolePermissionsRelations,
  userRolesRelations,
  roleInheritsRelations,
} from "../rbac/postgres";

// API keys.
export { apiKeys, apiKeysRelations } from "../api-keys/postgres";

// Audit.
export { auditLog, activityLog, activityLogRelations } from "../audit/postgres";

// Media.
export {
  media,
  mediaFolders,
  imageSizes,
  mediaRelations,
  mediaFoldersRelations,
} from "../media/postgres";

// Nextly meta + migration journal.
export { nextlyMeta } from "../nextly-meta/postgres";
export { nextlyMigrationJournalPg as nextlyMigrationJournal } from "../migration-journal/postgres";

// Dynamic collections / singles / components — aliased back to the bare
// names production code uses (the legacy stub flattened
// `dynamicCollectionsPg` → `dynamicCollections`, etc.).
export {
  dynamicCollectionsPg as dynamicCollections,
  dynamicCollectionsRelations,
} from "../dynamic-collections/postgres";
export { dynamicSinglesPg as dynamicSingles } from "../dynamic-singles/postgres";
export { dynamicComponentsPg as dynamicComponents } from "../dynamic-components/postgres";

// Singletons + lookup tables.
export { siteSettingsPg as siteSettings } from "../site-settings/postgres";
export { userFieldDefinitionsPg as userFieldDefinitions } from "../user-field-definitions/postgres";
export { emailProvidersPg as emailProviders } from "../email-providers/postgres";
export { emailTemplatesPg as emailTemplates } from "../email-templates/postgres";

// Legacy tables — kept for Plan A; dropped by Plan B's first task.
export { systemMigrations, contentSchemaEvents } from "../_legacy/postgres";
