/**
 * Flat SQLite dialect bundle.
 *
 * Replaces the legacy `database/schema/sqlite.ts` runtime surface deleted in
 * Plan A Task 17. See `./postgres.ts` for the rationale.
 *
 * @module schemas/_dialect-bundles/sqlite
 * @since v0.0.3-alpha (Plan A Task 17 — replaces database/schema/sqlite.ts)
 */

export {
  users,
  accounts,
  sessions,
  usersRelations,
  accountsRelations,
  sessionsRelations,
} from "../users/sqlite";

export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
  refreshTokensRelations,
} from "../auth-tokens/sqlite";

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
} from "../rbac/sqlite";

export { apiKeys, apiKeysRelations } from "../api-keys/sqlite";

export { auditLog, activityLog, activityLogRelations } from "../audit/sqlite";

export {
  media,
  mediaFolders,
  imageSizes,
  mediaRelations,
  mediaFoldersRelations,
} from "../media/sqlite";

export { nextlyMeta } from "../nextly-meta/sqlite";
export { nextlyMigrationJournalSqlite as nextlyMigrationJournal } from "../migration-journal/sqlite";

export {
  dynamicCollectionsSqlite as dynamicCollections,
  dynamicCollectionsRelations,
} from "../dynamic-collections/sqlite";
export { dynamicSinglesSqlite as dynamicSingles } from "../dynamic-singles/sqlite";
export { dynamicComponentsSqlite as dynamicComponents } from "../dynamic-components/sqlite";

export { siteSettingsSqlite as siteSettings } from "../site-settings/sqlite";
export { userFieldDefinitionsSqlite as userFieldDefinitions } from "../user-field-definitions/sqlite";
export { emailProvidersSqlite as emailProviders } from "../email-providers/sqlite";
export { emailTemplatesSqlite as emailTemplates } from "../email-templates/sqlite";

export { systemMigrations, contentSchemaEvents } from "../_legacy/sqlite";
