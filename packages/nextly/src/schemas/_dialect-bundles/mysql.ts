/**
 * Flat MySQL dialect bundle.
 *
 * Replaces the legacy `database/schema/mysql.ts` runtime surface deleted in
 * Plan A Task 17. See `./postgres.ts` for the rationale.
 *
 * @module schemas/_dialect-bundles/mysql
 * @since v0.0.3-alpha (Plan A Task 17 — replaces database/schema/mysql.ts)
 */

export {
  users,
  accounts,
  sessions,
  usersRelations,
  accountsRelations,
  sessionsRelations,
} from "../users/mysql";

export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
  refreshTokensRelations,
} from "../auth-tokens/mysql";

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
} from "../rbac/mysql";

export { apiKeys, apiKeysRelations } from "../api-keys/mysql";

export { auditLog, activityLog, activityLogRelations } from "../audit/mysql";

export {
  media,
  mediaFolders,
  imageSizes,
  mediaRelations,
  mediaFoldersRelations,
} from "../media/mysql";

export { nextlyMeta } from "../nextly-meta/mysql";
export { nextlyMigrationJournalMysql as nextlyMigrationJournal } from "../migration-journal/mysql";

export {
  dynamicCollectionsMysql as dynamicCollections,
  dynamicCollectionsRelations,
} from "../dynamic-collections/mysql";
export { dynamicSinglesMysql as dynamicSingles } from "../dynamic-singles/mysql";
export { dynamicComponentsMysql as dynamicComponents } from "../dynamic-components/mysql";

export { siteSettingsMysql as siteSettings } from "../site-settings/mysql";
export { userFieldDefinitionsMysql as userFieldDefinitions } from "../user-field-definitions/mysql";
export { emailProvidersMysql as emailProviders } from "../email-providers/mysql";
export { emailTemplatesMysql as emailTemplates } from "../email-templates/mysql";

export { systemMigrations, contentSchemaEvents } from "../_legacy/mysql";
