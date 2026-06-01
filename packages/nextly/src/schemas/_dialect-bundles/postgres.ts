/**
 * Flat PostgreSQL dialect bundle.
 *
 * Replaces the legacy `database/schema/postgres.ts` runtime surface deleted
 * in Plan A Task 17. Re-exports every Drizzle table + relations the
 * framework manages, drawn from the canonical per-feature
 * `schemas/<feature>/postgres.ts` modules, under the bare names callers
 * have always used (`apiKeys`, `users`, `dynamicCollections`, …).
 *
 * Tables are sourced from `<feature>/postgres.ts`; relations from
 * `<feature>/postgres-relations.ts`. The table modules deliberately do NOT
 * re-export their relations — that back-edge created a table↔relations import
 * cycle that left tables `undefined` at module-load. This bundle is the join
 * point instead, so the dependency stays one-directional (relations → tables).
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

// Users + Auth.js identity.
export { users, accounts, sessions } from "../users/postgres";
export {
  usersRelations,
  accountsRelations,
  sessionsRelations,
} from "../users/postgres-relations";

// Auth tokens.
export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "../auth-tokens/postgres";
export { refreshTokensRelations } from "../auth-tokens/postgres-relations";

// RBAC.
export {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "../rbac/postgres";
export {
  rolesRelations,
  permissionsRelations,
  rolePermissionsRelations,
  userRolesRelations,
  roleInheritsRelations,
} from "../rbac/postgres-relations";

// API keys.
export { apiKeys } from "../api-keys/postgres";
export { apiKeysRelations } from "../api-keys/postgres-relations";

// Audit.
export { auditLog, activityLog } from "../audit/postgres";
export { activityLogRelations } from "../audit/postgres-relations";

// Media.
export { media, mediaFolders, imageSizes } from "../media/postgres";
export {
  mediaRelations,
  mediaFoldersRelations,
} from "../media/postgres-relations";

// Nextly meta.
export { nextlyMeta } from "../nextly-meta/postgres";

// Dynamic collections / singles / components — aliased back to the bare
// names production code uses (the legacy stub flattened
// `dynamicCollectionsPg` → `dynamicCollections`, etc.).
export { dynamicCollectionsPg as dynamicCollections } from "../dynamic-collections/postgres";
export { dynamicCollectionsRelations } from "../dynamic-collections/postgres-relations";
export { dynamicSinglesPg as dynamicSingles } from "../dynamic-singles/postgres";
export { dynamicComponentsPg as dynamicComponents } from "../dynamic-components/postgres";

// Singletons + lookup tables.
export { siteSettingsPg as siteSettings } from "../site-settings/postgres";
export { userFieldDefinitionsPg as userFieldDefinitions } from "../user-field-definitions/postgres";
export { emailProvidersPg as emailProviders } from "../email-providers/postgres";
export { emailTemplatesPg as emailTemplates } from "../email-templates/postgres";

// Legacy tables — kept for Plan A; dropped by Plan B's first task.
export { systemMigrations, contentSchemaEvents } from "../_legacy/postgres";
