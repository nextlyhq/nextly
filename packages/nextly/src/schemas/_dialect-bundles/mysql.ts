/**
 * Flat MySQL dialect bundle.
 *
 * Replaces the legacy `database/schema/mysql.ts` runtime surface deleted in
 * Plan A Task 17. See `./postgres.ts` for the rationale — including why
 * relations are sourced from `<feature>/mysql-relations.ts` rather than
 * re-exported by the table modules (avoids a table↔relations import cycle).
 *
 * @module schemas/_dialect-bundles/mysql
 * @since v0.0.3-alpha (Plan A Task 17 — replaces database/schema/mysql.ts)
 */

export { users, accounts, sessions } from "../users/mysql";
export {
  usersRelations,
  accountsRelations,
  sessionsRelations,
} from "../users/mysql-relations";

export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../auth-tokens/mysql";
export { refreshTokensRelations } from "../auth-tokens/mysql-relations";

export {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "../rbac/mysql";
export {
  rolesRelations,
  permissionsRelations,
  rolePermissionsRelations,
  userRolesRelations,
  roleInheritsRelations,
} from "../rbac/mysql-relations";

export { apiKeys } from "../api-keys/mysql";
export { apiKeysRelations } from "../api-keys/mysql-relations";

export { auditLog, activityLog } from "../audit/mysql";
export { activityLogRelations } from "../audit/mysql-relations";

export { media, mediaFolders, imageSizes } from "../media/mysql";
export {
  mediaRelations,
  mediaFoldersRelations,
} from "../media/mysql-relations";

export { nextlyMeta } from "../nextly-meta/mysql";

export { dynamicCollectionsMysql as dynamicCollections } from "../dynamic-collections/mysql";
export { dynamicCollectionsRelations } from "../dynamic-collections/mysql-relations";
export { dynamicSinglesMysql as dynamicSingles } from "../dynamic-singles/mysql";
export { dynamicComponentsMysql as dynamicComponents } from "../dynamic-components/mysql";

export { siteSettingsMysql as siteSettings } from "../site-settings/mysql";
export { userFieldDefinitionsMysql as userFieldDefinitions } from "../user-field-definitions/mysql";
export { emailProvidersMysql as emailProviders } from "../email-providers/mysql";
export { emailTemplatesMysql as emailTemplates } from "../email-templates/mysql";

export { systemMigrations, contentSchemaEvents } from "../_legacy/mysql";
