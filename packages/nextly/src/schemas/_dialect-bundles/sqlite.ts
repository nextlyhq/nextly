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
  emailVerificationTokens,
  passwordResetTokens,
  userInviteTokens,
  refreshTokens,
} from "../auth-tokens/sqlite";

export {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "../rbac/sqlite";

export { apiKeys } from "../api-keys/sqlite";

export { auditLog, activityLog } from "../audit/sqlite";

export { media, mediaFolders, imageSizes } from "../media/sqlite";

export { nextlyMeta } from "../nextly-meta/sqlite";

export { dynamicCollectionsSqlite as dynamicCollections } from "../dynamic-collections/sqlite";
export { dynamicSinglesSqlite as dynamicSingles } from "../dynamic-singles/sqlite";
export { dynamicComponentsSqlite as dynamicComponents } from "../dynamic-components/sqlite";

export { siteSettingsSqlite as siteSettings } from "../site-settings/sqlite";
export { userFieldDefinitionsSqlite as userFieldDefinitions } from "../user-field-definitions/sqlite";
export { emailProvidersSqlite as emailProviders } from "../email-providers/sqlite";
export { emailTemplatesSqlite as emailTemplates } from "../email-templates/sqlite";

export { nextlySchemaEventsSqlite as nextlySchemaEvents } from "../schema-events/sqlite";

// Content-version store; in the bundle so the adapter table resolver can
// resolve `nextly_versions` (a managed core table) for runtime CRUD.
export { nextlyVersionsSqlite as nextlyVersions } from "../versions/sqlite";

// Localization archive; in the bundle so freshPushSchema creates it. Being in
// getCoreSchema alone only makes it diffable: the apply pushes this map, so a
// table missing here is proposed on every reconcile and created by none.
export { nextlyI18nArchive } from "../nextly-i18n-archive/sqlite";

// Webhook + event system tables. Must be in this flat bundle (not just
// getCoreSchema) so freshPushSchema creates them on a fresh database.
export {
  nextlyEvents,
  nextlyWebhooks,
  nextlyWebhookDeliveries,
} from "../webhooks/sqlite";
