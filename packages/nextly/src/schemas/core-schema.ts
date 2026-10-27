/**
 * The framework's core schema: which tables Nextly manages and the shape each
 * should have, for one dialect.
 *
 * Apart from `schemas/index.ts` so the package's own code can ask it without
 * loading what that public entry also re-exports for direct-query callers,
 * PostgreSQL's tables among them. Every table here comes from the loaded
 * dialect's bundle, so asking about one dialect imports only its files.
 *
 * @module schemas/core-schema
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { isTable, type Table } from "drizzle-orm";

import { loadedDialect } from "../database/dialect-tables";
import { buildFieldGroupRegistryTable } from "../domains/field-groups/storage/registry-schemas";
import type { NextlySchemaSnapshot } from "../domains/schema/pipeline/diff/types";
import { MANAGED_TABLE_PREFIXES } from "../domains/schema/pipeline/managed-tables";
import { NextlyError } from "../errors/nextly-error";

import { drizzleTableToTableSpec } from "./_internal/drizzle-to-tablespec";
import { apiKeyTables } from "./api-keys";
import { auditTables } from "./audit";
import { authTokenTables } from "./auth-tokens";
import { contentEventsTables } from "./content-events";
import {
  DELETED_PRINCIPALS_TABLE,
  deletedPrincipalsTables,
} from "./deleted-principals";
import { documentLockTables } from "./document-lock";
import { emailBrandTables } from "./email-brand";
import { EMAIL_QUEUE_TABLE } from "./email-queue/table-name";
import { EMAIL_QUEUE_RECIPIENTS_TABLE } from "./email-queue-recipients/table-name";
import { EMAIL_SEND_CLAIMS_TABLE } from "./email-send-claims/table-name";
import { fieldGroupLockTables, schemaLockTables } from "./field-group-lock";
import { jobsTables } from "./jobs";
import { languagesTables } from "./languages";
import { LIMIT_STORE_TABLE, limitStoreTables } from "./limit-store";
import { mediaTables } from "./media";
import { nextlyI18nArchiveTables } from "./nextly-i18n-archive";
import { nextlyMetaTables } from "./nextly-meta";
import { noticesTables } from "./notices";
import {
  ONE_TIME_SECRETS_TABLE,
  oneTimeSecretsTables,
} from "./one-time-secrets";
import { PLUGIN_SETTINGS_TABLE, pluginSettingsTables } from "./plugin-settings";
import { previewLinksTables } from "./preview-links";
import { rbacTables } from "./rbac";
import { RBAC_EPOCH_TABLE, rbacEpochTables } from "./rbac-epoch";
import { releasesTables } from "./releases";
import { schemaEventsTables } from "./schema-events";
import { SCHEMA_OWNERS_TABLE, schemaOwnersTables } from "./schema-owners";
import {
  SPENT_CHALLENGES_TABLE,
  spentChallengesTables,
} from "./spent-challenges";
import { STORAGE_FORMAT } from "./storage-format";
import { userTables } from "./users";
import { versionPinsTables } from "./version-pins";
import { versionViewsTables } from "./version-views";
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
): Table {
  const name = options?.fieldGroupRegistryTable;
  if (name === undefined || name === STORAGE_FORMAT.registryTable) {
    // The loaded dialect's own registry, so only that dialect's files are
    // imported; `createAdapter` loads them.
    return loadedDialect(dialect).tables.dynamicFieldGroups;
  }
  const built = buildFieldGroupRegistryTable(dialect, name);
  // The builder is typed `unknown` across dialects; what it builds is a table,
  // and anything else would reach the schema as a hole rather than an error.
  if (!isTable(built)) {
    throw NextlyError.internal({
      logContext: {
        reason: "the field-group registry builder returned no table",
        dialect,
        table: name,
      },
    });
  }
  return built;
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
  const tables: Table[] = [
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
    // `nextly_schema_lock` — the one schema lock every schema change holds. Bootstrapped by the
    // first run that contends for it, from the same declaration, and declared here for the reason
    // the field-group lock above is: so a reconcile can carry a later change onto it.
    ...Object.values(schemaLockTables(dialect)),
    // `nextly_document_lock` — one row per document being edited right now.
    // Declared here because it is the set `nextly migrate` pushes: a table
    // outside it is never created on a real installation, however completely
    // its own module declares it.
    ...Object.values(documentLockTables(dialect)),
    // `nextly_rbac_epoch` — the one counter every instance reads to decide
    // whether a cached authorization answer is still current. Declared here for
    // the same reason as the lock above: a table outside this set is never
    // created on a real installation, however completely its own module
    // declares it.
    ...Object.values(rbacEpochTables(dialect)),
    // `nextly_deleted_principals` — the plugin-defined people reported
    // deleted, by a keyed digest. Declared here for the same reason as its
    // neighbours: a table outside this set is never created on a real
    // installation.
    ...Object.values(deletedPrincipalsTables(dialect)),
    // `nextly_plugin_settings` — where a plugin's configuration lives, with
    // the keys it declared as secrets encrypted at rest. Declared here for the
    // same reason as its neighbours: a table outside this set is never created
    // on a real installation, however completely its own module declares it.
    ...Object.values(pluginSettingsTables(dialect)),
    // `nextly_one_time_secrets` — the one-purpose links and codes plugins
    // mint, each stored only as a keyed hash. Declared here for the same
    // reason as its neighbours.
    ...Object.values(oneTimeSecretsTables(dialect)),
    // `nextly_limit_store` — the counts of the database limit store, used only
    // when a site selects it. Declared here for the same reason as its
    // neighbours: a table outside this set is never created on a real
    // installation, however completely its own module declares it.
    ...Object.values(limitStoreTables(dialect)),
    // `nextly_spent_challenges` — the two-factor challenges already answered,
    // so an answer is accepted once on every instance. Declared here for the
    // same reason as its neighbours: a table outside this set is never created
    // on a real installation, however completely its own module declares it.
    ...Object.values(spentChallengesTables(dialect)),
    // `nextly_schema_owners` — which owner each table belongs to, and which
    // migration stream carries it. A table with no row here is never dropped
    // by any path, so absence is the safe answer rather than an invitation.
    ...Object.values(schemaOwnersTables(dialect)),
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
    // `nextly_version_views` — each person's "last looked at" marker per
    // document and part. Nothing marks before the table exists, so
    // core-reconcile creating it is sufficient, as for `nextly_versions`.
    ...Object.values(versionViewsTables(dialect)),
    // The record of content events and the parts each one involved. Nothing
    // records into them before they exist, so core-reconcile creating them is
    // sufficient, as for `nextly_versions`.
    ...Object.values(contentEventsTables(dialect)),
    // Recorded preview links. Nothing records into it before it exists: a
    // mint finding it missing refuses with the migrate remedy, so
    // core-reconcile creating it is sufficient, as for `nextly_versions`.
    ...Object.values(previewLinksTables(dialect)),
    // The site's content languages when Settings manages them. Created empty and read as "no
    // stored languages" when missing, so a site that never adds a language is unchanged.
    ...Object.values(languagesTables(dialect)),
    // The release tables are first-class managed system tables, declared here
    // for the same reason `nextly_versions` is: nothing records into them
    // before they exist, so core-reconcile creating them on fresh and existing
    // databases is sufficient. Declaring the Drizzle tables alone would not be
    // — a table absent from this snapshot is never created by db:sync, and the
    // SQLite bootstrap fallback would hide that on one dialect only.
    ...Object.values(releasesTables(dialect)),
    // `nextly_version_pins` — the versions a feature holds against retention.
    // Here for the same reason as the release tables: nothing pins before the
    // table exists, so core-reconcile creating it is sufficient.
    ...Object.values(versionPinsTables(dialect)),
    ...Object.values(jobsTables(dialect)),
    ...Object.values(webhookTables(dialect)),
    // `nextly_widget_layout` — one row per reader who has arranged the
    // dashboard. Declared here for the same reason as every table above: the
    // snapshot is the set `nextly migrate` pushes, so a table outside it is
    // never created on a real installation however completely its own module
    // declares it.
    ...Object.values(widgetLayoutTables(dialect)),
    // `nextly_notices` — each person's own notices. In the snapshot for the
    // reason every table above is: it is the set `nextly migrate` creates.
    ...Object.values(noticesTables(dialect)),
    // `email_brand` — the site's email brand settings, one row. In the
    // snapshot for the reason every table above is.
    ...Object.values(emailBrandTables(dialect)),
  ];

  const fieldGroupRegistry = fieldGroupRegistryFor(dialect, options);

  // The rest of the core tables, from the loaded dialect's bundle, which
  // re-exports each dialect's own definitions under these names: only that
  // dialect's files are imported.
  const loaded = loadedDialect(dialect).tables;
  tables.push(
    loaded.dynamicCollections,
    loaded.dynamicSingles,
    fieldGroupRegistry,
    loaded.siteSettings,
    loaded.userFieldDefinitions,
    loaded.emailProviders,
    loaded.emailTemplates,
    loaded.emailDeliveries,
    loaded.emailSendClaims,
    loaded.emailQueue,
    loaded.emailQueueRecipients
  );

  return {
    // 🔴 An arrow, not a bare reference. `map` passes the ARRAY INDEX as the
    // second argument, which this function now reads as a dialect -- so
    // `tables.map(drizzleTableToTableSpec)` would hand table 0 the dialect `0`
    // and silently drop every table's indexes but one.
    tables: tables.map(table => drizzleTableToTableSpec(table, dialect)),
  };
}

/** Snake-case names of every core table the framework manages. */
export const CORE_TABLE_NAMES: readonly string[] = [
  "users",
  "password_reset_tokens",
  "user_invite_tokens",
  "email_verification_tokens",
  "refresh_tokens",
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "role_inherits",
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
  "nextly_schema_lock",
  "nextly_document_lock",
  RBAC_EPOCH_TABLE,
  DELETED_PRINCIPALS_TABLE,
  PLUGIN_SETTINGS_TABLE,
  ONE_TIME_SECRETS_TABLE,
  LIMIT_STORE_TABLE,
  SPENT_CHALLENGES_TABLE,
  SCHEMA_OWNERS_TABLE,
  "nextly_widget_layout",
  "dynamic_collections",
  "dynamic_singles",
  STORAGE_FORMAT.registryTable,
  "site_settings",
  "user_field_definitions",
  "email_providers",
  "email_templates",
  "email_deliveries",
  "email_brand",
  EMAIL_SEND_CLAIMS_TABLE,
  EMAIL_QUEUE_TABLE,
  EMAIL_QUEUE_RECIPIENTS_TABLE,
  "nextly_schema_events",
  "nextly_i18n_archive",
  "nextly_versions",
  "nextly_version_views",
  "nextly_content_events",
  "nextly_content_event_parts",
  "nextly_preview_links",
  "nextly_languages",
  "nextly_releases",
  "nextly_release_members",
  "nextly_version_pins",
  "nextly_jobs",
  "nextly_events",
  "nextly_webhooks",
  "nextly_webhook_deliveries",
  "nextly_notices",
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
