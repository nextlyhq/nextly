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

import { buildFieldGroupRegistryTable } from "../domains/field-groups/storage/registry-schemas";
import type { NextlySchemaSnapshot } from "../domains/schema/pipeline/diff/types";
import { MANAGED_TABLE_PREFIXES } from "../domains/schema/pipeline/managed-tables";
import { NextlyError } from "../errors/nextly-error";

import { drizzleTableToTableSpec } from "./_internal/drizzle-to-tablespec";
import { apiKeyTables } from "./api-keys";
import { auditTables } from "./audit";
import { authTokenTables } from "./auth-tokens";
import { documentLockTables } from "./document-lock";
import {
  dynamicCollectionsPg,
  dynamicCollectionsMysql,
  dynamicCollectionsSqlite,
} from "./dynamic-collections";
import {
  dynamicFieldGroupsPg,
  dynamicFieldGroupsMysql,
  dynamicFieldGroupsSqlite,
} from "./dynamic-field-groups";
import { dynamicSinglesMysql } from "./dynamic-singles/mysql";
import { dynamicSinglesPg } from "./dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "./dynamic-singles/sqlite";
import { emailDeliveriesMysql } from "./email-deliveries/mysql";
import { emailDeliveriesPg } from "./email-deliveries/postgres";
import { emailDeliveriesSqlite } from "./email-deliveries/sqlite";
import { emailProvidersMysql } from "./email-providers/mysql";
import { emailProvidersPg } from "./email-providers/postgres";
import { emailProvidersSqlite } from "./email-providers/sqlite";
import { emailTemplatesMysql } from "./email-templates/mysql";
import { emailTemplatesPg } from "./email-templates/postgres";
import { emailTemplatesSqlite } from "./email-templates/sqlite";
import { fieldGroupLockTables } from "./field-group-lock";
import { jobsTables } from "./jobs";
import { mediaTables } from "./media";
import { nextlyI18nArchiveTables } from "./nextly-i18n-archive";
import { nextlyMetaTables } from "./nextly-meta";
import { rbacTables } from "./rbac";
import { releasesTables } from "./releases";
import { schemaEventsTables } from "./schema-events";
import { siteSettingsMysql } from "./site-settings/mysql";
import { siteSettingsPg } from "./site-settings/postgres";
import { siteSettingsSqlite } from "./site-settings/sqlite";
import { STORAGE_FORMAT } from "./storage-format";
import { userFieldDefinitionsMysql } from "./user-field-definitions/mysql";
import { userFieldDefinitionsPg } from "./user-field-definitions/postgres";
import { userFieldDefinitionsSqlite } from "./user-field-definitions/sqlite";
import { userTables } from "./users";
import { versionsTables } from "./versions";
import { webhookTables } from "./webhooks";
import { widgetLayoutTables } from "./widget-layout";

// =============================================================================
// Public API — populated incrementally by Plan A tasks 4–14.
// =============================================================================

/**
 * Which field-group registry a particular database holds.
 *
 * 🔴 The core schema is a DESIRED shape, and a desired shape that names a table
 * the database does not have is an instruction to create it. The storage
 * migration renames the registry, so a caller holding a real database resolves
 * the name from the catalog and passes it here; omitting it keeps the legacy
 * spelling, which is correct for a fresh database and for every caller that has
 * no database to ask.
 *
 * Without this, reconciling a migrated database creates an EMPTY legacy
 * registry beside the populated migrated one — and every reader prefers the
 * legacy name when it is present, so the site's field groups silently vanish.
 */
export interface CoreSchemaOptions {
  /** Defaults to the legacy spelling this release's DDL writes. */
  fieldGroupRegistryTable?: string;
}

/**
 * The field-group registry object for a dialect, under whichever name applies.
 *
 * Returns the module-level constant unchanged for the legacy name so the common
 * path keeps object identity, and builds one only when a database really has
 * been migrated.
 */
function fieldGroupRegistryFor(
  dialect: SupportedDialect,
  options?: CoreSchemaOptions
): unknown {
  const name = options?.fieldGroupRegistryTable;
  if (name === undefined || name === STORAGE_FORMAT.registryTable) {
    switch (dialect) {
      case "postgresql":
        return dynamicFieldGroupsPg;
      case "mysql":
        return dynamicFieldGroupsMysql;
      case "sqlite":
        return dynamicFieldGroupsSqlite;
      default: {
        const exhaustive: never = dialect;
        throw NextlyError.internal({
          logContext: {
            reason: "cannot build the field-group registry for this dialect",
            dialect: String(exhaustive),
          },
        });
      }
    }
  }
  return buildFieldGroupRegistryTable(dialect, name);
}

/**
 * Snake-case names of every core table the framework manages.
 *
 * Takes the same options as {@link getCoreSchema} for the same reason: the two
 * are read together — one names the tables to introspect, the other the shape to
 * compare them against — so a mismatch between them asks the database about a
 * table that is not there and then diffs the answer against one that is.
 */
export function getCoreTableNames(options?: CoreSchemaOptions): string[] {
  return CORE_TABLE_NAMES.map(name =>
    name === STORAGE_FORMAT.registryTable
      ? (options?.fieldGroupRegistryTable ?? name)
      : name
  );
}

/**
 * Canonical core schema snapshot for the given dialect.
 *
 * Consumed by every pipeline entry point (boot-apply, db:sync, migrate Phase 1,
 * migrate:check) to drive introspect-and-diff.
 *
 * @param dialect - the runtime dialect to compile the snapshot for
 * @param options - which field-group registry this database actually holds
 * @returns a frozen snapshot of all framework-managed tables for that dialect
 */
export function getCoreSchema(
  dialect: SupportedDialect,
  options?: CoreSchemaOptions
): NextlySchemaSnapshot {
  const tables = [
    ...Object.values(userTables(dialect)),
    ...Object.values(authTokenTables(dialect)),
    ...Object.values(rbacTables(dialect)),
    ...Object.values(mediaTables(dialect)),
    ...Object.values(auditTables(dialect)),
    ...Object.values(nextlyMetaTables(dialect)),
    // `nextly_field_group_lock` — the storage migration's mutual-exclusion row. Bootstrapped
    // out-of-band by the migration session (it must exist before anything can contend for it),
    // and declared here so it is RECONCILABLE: the bootstrap is `CREATE TABLE IF NOT EXISTS`, so
    // without this a column could never be added to an existing installation's copy. Same reasoning
    // as `nextly_schema_events` and `nextly_i18n_archive` below.
    ...Object.values(fieldGroupLockTables(dialect)),
    // `nextly_document_lock` — one row per document being edited right now.
    // Declared here because it is the set `nextly migrate` pushes: a table
    // outside it is never created on a real installation, however completely
    // its own module declares it.
    ...Object.values(documentLockTables(dialect)),
    ...Object.values(apiKeyTables(dialect)),
    // `nextly_schema_events` (the migration ledger) is a first-class managed
    // table. It is still bootstrapped out-of-band via `getSchemaEventsDdl` so
    // it exists before `nextly migrate` records into it, but it now round-trips
    // cleanly against this definition (NOT NULL PK; no SQLite partial index —
    // drizzle-kit 0.31.10 can't round-trip one, drizzle-team/drizzle-orm#4688),
    // so declaring it here is a no-op when the on-disk table already matches.
    ...Object.values(schemaEventsTables(dialect)),
    // `nextly_i18n_archive` — holds non-default-locale translations removed when
    // localization is disabled (recoverable backup). Bootstrapped out-of-band via
    // `getI18nArchiveDdl` for existing DBs; declared here for fresh installs.
    ...Object.values(nextlyI18nArchiveTables(dialect)),
    // `nextly_versions` is a first-class managed system table. It has no
    // bootstrap-ordering constraint (nothing records into it before it exists,
    // unlike the migration ledger), so declaring it here is sufficient:
    // core-reconcile creates it on fresh and existing databases.
    ...Object.values(versionsTables(dialect)),
    // The release tables are first-class managed system tables, declared here
    // for the same reason `nextly_versions` is: nothing records into them
    // before they exist, so core-reconcile creating them on fresh and existing
    // databases is sufficient. Declaring the Drizzle tables alone would not be
    // — a table absent from this snapshot is never created by db:sync, and the
    // SQLite bootstrap fallback would hide that on one dialect only.
    ...Object.values(releasesTables(dialect)),
    ...Object.values(jobsTables(dialect)),
    ...Object.values(webhookTables(dialect)),
    // `nextly_widget_layout` — one row per reader who has arranged the
    // dashboard. Declared here for the same reason as every table above: the
    // snapshot is the set `nextly migrate` pushes, so a table outside it is
    // never created on a real installation however completely its own module
    // declares it.
    ...Object.values(widgetLayoutTables(dialect)),
  ];

  const fieldGroupRegistry = fieldGroupRegistryFor(dialect, options);

  // Per-dialect tables for feature groups whose dialect subdirs predate Plan A.
  switch (dialect) {
    case "postgresql":
      tables.push(
        dynamicCollectionsPg,
        dynamicSinglesPg,
        fieldGroupRegistry,
        siteSettingsPg,
        userFieldDefinitionsPg,
        emailProvidersPg,
        emailTemplatesPg,
        emailDeliveriesPg
      );
      break;
    case "mysql":
      tables.push(
        dynamicCollectionsMysql,
        dynamicSinglesMysql,
        fieldGroupRegistry,
        siteSettingsMysql,
        userFieldDefinitionsMysql,
        emailProvidersMysql,
        emailTemplatesMysql,
        emailDeliveriesMysql
      );
      break;
    case "sqlite":
      tables.push(
        dynamicCollectionsSqlite,
        dynamicSinglesSqlite,
        fieldGroupRegistry,
        siteSettingsSqlite,
        userFieldDefinitionsSqlite,
        emailProvidersSqlite,
        emailTemplatesSqlite,
        emailDeliveriesSqlite
      );
      break;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "cannot build the core schema for this dialect",
          dialect: String(_exhaustive),
        },
      });
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
  "password_reset_tokens",
  "user_invite_tokens",
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
  // Read by live introspection. Absent here, the table is created and then invisible to every
  // snapshot, so the drift check proposes adding it again on every run.
  "nextly_field_group_lock",
  "nextly_document_lock",
  "nextly_widget_layout",
  "dynamic_collections",
  "dynamic_singles",
  STORAGE_FORMAT.registryTable,
  "site_settings",
  "user_field_definitions",
  "email_providers",
  "email_templates",
  "email_deliveries",
  "nextly_schema_events",
  "nextly_i18n_archive",
  "nextly_versions",
  "nextly_releases",
  "nextly_release_members",
  "nextly_jobs",
  "nextly_events",
  "nextly_webhooks",
  "nextly_webhook_deliveries",
] as const;

/**
 * Prefixes that identify managed user tables.
 *
 * Derived from the pipeline's own filter rather than restated, so the two
 * cannot disagree about what Nextly manages. They did: this list named three
 * prefixes while the filter named four, and a table the filter manages but this
 * list does not is one the CLI treats as foreign.
 */
export const CORE_TABLE_PREFIXES: readonly string[] = MANAGED_TABLE_PREFIXES;

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
  emailVerificationTokens,
  passwordResetTokens,
  userInviteTokens,
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

// Content-versioning store. PG re-export for direct-query callers, matching the
// other managed core tables listed in CORE_TABLE_NAMES.
export { nextlyVersionsPg as nextlyVersions } from "./versions/postgres";
export * from "./dynamic-collections"; // dialect-aware barrel — kept; unchanged
export * from "./dynamic-field-groups"; // kept; unchanged
// Plan A Task 11 — apiKeys (Drizzle). PG re-exports for direct-query callers.
// The Zod validators (CreateApiKeySchema, UpdateApiKeySchema, etc.) live at
// schemas/_zod/api-keys.ts and are re-exported via `export * from "./_zod"`
// at the top of this file.
export { apiKeys } from "./api-keys/postgres";
// Webhook + event system tables. PG re-exports for direct-query callers who
// want to inspect the event/webhook/delivery ledger via the `nextly/schemas`
// subpath; other dialects are reachable through getCoreSchema(dialect).
export {
  nextlyEvents,
  nextlyWebhooks,
  nextlyWebhookDeliveries,
} from "./webhooks/postgres";
export * from "./security-config"; // Zod — review in Task 19

// Content-release lifecycle vocabulary. Types only: the admin renders a state
// and must not be able to name one the engine cannot produce, and a second
// spelling of these unions in a client is how a screen starts describing a
// state the server has never sent.
export type {
  ReleaseState,
  ReleaseMemberAction,
  ReleaseBlockerReason,
} from "./releases/types";
