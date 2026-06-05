/**
 * Flat SQLite dialect bundle.
 *
 * Replaces the legacy `database/schema/sqlite.ts` runtime surface deleted in
 * Plan A Task 17. See `./postgres.ts` for the rationale — including why
 * relations are sourced from `<feature>/sqlite-relations.ts` rather than
 * re-exported by the table modules (avoids a table↔relations import cycle).
 *
 * @module schemas/_dialect-bundles/sqlite
 * @since v0.0.3-alpha (Plan A Task 17 — replaces database/schema/sqlite.ts)
 */

export { users, accounts, sessions } from "../users/sqlite";
export {
  usersRelations,
  accountsRelations,
  sessionsRelations,
} from "../users/sqlite-relations";

export {
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../auth-tokens/sqlite";
export { refreshTokensRelations } from "../auth-tokens/sqlite-relations";

export {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "../rbac/sqlite";
export {
  rolesRelations,
  permissionsRelations,
  rolePermissionsRelations,
  userRolesRelations,
  roleInheritsRelations,
} from "../rbac/sqlite-relations";

export { apiKeys } from "../api-keys/sqlite";
export { apiKeysRelations } from "../api-keys/sqlite-relations";

export { auditLog, activityLog } from "../audit/sqlite";
export { activityLogRelations } from "../audit/sqlite-relations";

export { media, mediaFolders, imageSizes } from "../media/sqlite";
export {
  mediaRelations,
  mediaFoldersRelations,
} from "../media/sqlite-relations";

export { nextlyMeta } from "../nextly-meta/sqlite";

export { dynamicCollectionsSqlite as dynamicCollections } from "../dynamic-collections/sqlite";
export { dynamicCollectionsRelations } from "../dynamic-collections/sqlite-relations";
export { dynamicSinglesSqlite as dynamicSingles } from "../dynamic-singles/sqlite";
export { dynamicComponentsSqlite as dynamicComponents } from "../dynamic-components/sqlite";

export { siteSettingsSqlite as siteSettings } from "../site-settings/sqlite";
export { userFieldDefinitionsSqlite as userFieldDefinitions } from "../user-field-definitions/sqlite";
export { emailProvidersSqlite as emailProviders } from "../email-providers/sqlite";
export { emailTemplatesSqlite as emailTemplates } from "../email-templates/sqlite";
