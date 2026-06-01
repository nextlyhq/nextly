/**
 * Public schemas barrel for Nextly.
 *
 * Single canonical entry point for the framework's system table definitions.
 * Imported by every pipeline caller (boot-apply, db-sync, migrate, migrate:create)
 * and by user code that wants to query core tables directly.
 *
 * Public contract:
 *   - getCoreSchema(dialect) → NextlySchemaSnapshot
 *   - CORE_TABLE_NAMES: readonly string[]
 *   - CORE_TABLE_PREFIXES: readonly string[]
 *   - Named Drizzle table re-exports (users, accounts, roles, etc.) under their
 *     canonical names.
 *
 * @module schemas
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { NextlySchemaSnapshot } from "../domains/schema/pipeline/diff/types";

import { drizzleTableToTableSpec } from "./_internal/drizzle-to-tablespec";
import { apiKeyTables } from "./api-keys";
import { auditTables } from "./audit";
import { authTokenTables } from "./auth-tokens";
import {
  dynamicCollectionsPg,
  dynamicCollectionsMysql,
  dynamicCollectionsSqlite,
} from "./dynamic-collections";
import {
  dynamicComponentsPg,
  dynamicComponentsMysql,
  dynamicComponentsSqlite,
} from "./dynamic-components";
import { dynamicSinglesMysql } from "./dynamic-singles/mysql";
import { dynamicSinglesPg } from "./dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "./dynamic-singles/sqlite";
import { emailProvidersMysql } from "./email-providers/mysql";
import { emailProvidersPg } from "./email-providers/postgres";
import { emailProvidersSqlite } from "./email-providers/sqlite";
import { emailTemplatesMysql } from "./email-templates/mysql";
import { emailTemplatesPg } from "./email-templates/postgres";
import { emailTemplatesSqlite } from "./email-templates/sqlite";
import { mediaTables } from "./media";
import { nextlyMetaTables } from "./nextly-meta";
import { rbacTables } from "./rbac";
import { schemaEventsTables } from "./schema-events";
import { siteSettingsMysql } from "./site-settings/mysql";
import { siteSettingsPg } from "./site-settings/postgres";
import { siteSettingsSqlite } from "./site-settings/sqlite";
import { userFieldDefinitionsMysql } from "./user-field-definitions/mysql";
import { userFieldDefinitionsPg } from "./user-field-definitions/postgres";
import { userFieldDefinitionsSqlite } from "./user-field-definitions/sqlite";
import { userTables } from "./users";

// =============================================================================
// Public API — populated incrementally by Plan A tasks 4–14.
// =============================================================================

/**
 * Canonical core schema snapshot for the given dialect.
 *
 * Consumed by every pipeline entry point (boot-apply, db:sync, migrate Phase 1,
 * migrate:check) to drive introspect-and-diff.
 *
 * @param _dialect - the runtime dialect to compile the snapshot for
 * @returns a frozen snapshot of all framework-managed tables for that dialect
 */
export function getCoreSchema(dialect: SupportedDialect): NextlySchemaSnapshot {
  const tables = [
    ...Object.values(userTables(dialect)),
    ...Object.values(authTokenTables(dialect)),
    ...Object.values(rbacTables(dialect)),
    ...Object.values(mediaTables(dialect)),
    ...Object.values(auditTables(dialect)),
    ...Object.values(nextlyMetaTables(dialect)),
    ...Object.values(apiKeyTables(dialect)),
    ...Object.values(schemaEventsTables(dialect)),
  ];

  // Per-dialect tables for feature groups whose dialect subdirs predate Plan A.
  switch (dialect) {
    case "postgresql":
      tables.push(
        dynamicCollectionsPg,
        dynamicSinglesPg,
        dynamicComponentsPg,
        siteSettingsPg,
        userFieldDefinitionsPg,
        emailProvidersPg,
        emailTemplatesPg
      );
      break;
    case "mysql":
      tables.push(
        dynamicCollectionsMysql,
        dynamicSinglesMysql,
        dynamicComponentsMysql,
        siteSettingsMysql,
        userFieldDefinitionsMysql,
        emailProvidersMysql,
        emailTemplatesMysql
      );
      break;
    case "sqlite":
      tables.push(
        dynamicCollectionsSqlite,
        dynamicSinglesSqlite,
        dynamicComponentsSqlite,
        siteSettingsSqlite,
        userFieldDefinitionsSqlite,
        emailProvidersSqlite,
        emailTemplatesSqlite
      );
      break;
    default: {
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }

  return {
    tables: tables.map(drizzleTableToTableSpec),
  };
}

/** Snake-case names of every core table the framework manages. */
export const CORE_TABLE_NAMES: readonly string[] = [
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  "password_reset_tokens",
  "email_verification_tokens",
  "refresh_tokens",
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "role_inherits",
  "user_permission_cache",
  "api_keys",
  "audit_log",
  "activity_log",
  "media",
  "media_folders",
  "image_sizes",
  "nextly_meta",
  "dynamic_collections",
  "dynamic_singles",
  "dynamic_components",
  "site_settings",
  "user_field_definitions",
  "email_providers",
  "email_templates",
  "nextly_schema_events",
] as const;

/** Prefixes that identify managed user tables (dc_, single_, comp_). */
export const CORE_TABLE_PREFIXES: readonly string[] = [
  "dc_",
  "single_",
  "comp_",
];

// =============================================================================
// Transitional re-exports — kept so existing consumers keep building during
// the feature-by-feature migration. Each existing export is dropped from this
// list as its replacement lands in schemas/<feature>/.
// =============================================================================

export * from "./_zod"; // Zod-only validators (user, rbac, validation)

// Plan A Task 5 — user identity tables. PG re-exports here for direct-query
// callers. Other dialects accessible via getCoreSchema(dialect).
export { users, accounts, sessions } from "./users/postgres";

// Plan A Task 6 — auth-token tables. PG re-exports for direct-query callers.
export {
  verificationTokens,
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
} from "./auth-tokens/postgres";

// Plan A Task 7 — RBAC tables (Drizzle). PG re-exports for direct-query callers.
// Distinct from schemas/_zod/rbac.ts which holds the Zod validators.
export {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
  userPermissionCache,
} from "./rbac/postgres";

// Plan A Task 8 — media tables. PG re-exports for direct-query callers.
export { media, mediaFolders, imageSizes } from "./media/postgres";

// Plan A Task 9 — audit tables. PG re-exports for direct-query callers.
export { auditLog, activityLog } from "./audit/postgres";

// Plan A Task 10 — nextly_meta runtime key/value flags table.
export { nextlyMeta } from "./nextly-meta/postgres";
// Plan B — schema-events bookkeeping table. PG re-export for direct-query callers.
export { nextlySchemaEventsPg as nextlySchemaEvents } from "./schema-events/postgres";
export * from "./dynamic-collections"; // dialect-aware barrel — kept; unchanged
export * from "./dynamic-components"; // kept; unchanged
// Plan A Task 11 — apiKeys (Drizzle). PG re-exports for direct-query callers.
// The Zod validators (CreateApiKeySchema, UpdateApiKeySchema, etc.) live at
// schemas/_zod/api-keys.ts and are re-exported via `export * from "./_zod"`
// at the top of this file.
export { apiKeys } from "./api-keys/postgres";
export * from "./security-config"; // Zod — review in Task 19
